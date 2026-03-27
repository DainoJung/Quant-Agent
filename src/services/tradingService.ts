import { Ticker, Candle, TradeLog, Account } from '../types';
import { apiService } from './apiService';
import { tradeStorage } from './tradeStorage';
import { geminiService, GeminiAnalysisResult } from './geminiService';

export interface RiskConfig {
  maxPositionSize: number; // 전체 자산의 최대 %
  maxDailyLoss: number; // 일일 최대 손실 %
  stopLossPercent: number; // 손절 %
  takeProfitPercent: number; // 익절 %
  maxOpenPositions: number; // 최대 동시 포지션
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionSize: 5, // 한 종목당 최대 5%
  maxDailyLoss: 10, // 일일 최대 손실 10%
  stopLossPercent: 3, // 손절 3%
  takeProfitPercent: 8, // 익절 8%
  maxOpenPositions: 3, // 최대 3개 동시 포지션
};

// 업비트 거래 수수료
export const UPBIT_FEE_PERCENT = 0.1;

// 업비트 최소 주문 금액
const UPBIT_MIN_ORDER_KRW = 5000;

// AI 분석 로그
export interface AiAnalysisLog {
  id: string;
  timestamp: number;
  market: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  analysis: string;
  rsi: number;
  ema20: number;
  ema50: number;
  buyScore: number;
  sellScore: number;
  inputTokens: number;
  outputTokens: number;
  costKrw: number;
  costUsd: number;
  phase: string; // 어느 단계에서 호출했는지
}

// 업비트 tick-size 규칙 (호가 단위)
function getTickSize(price: number): number {
  if (price >= 2000000) return 1000;
  if (price >= 1000000) return 500;
  if (price >= 500000) return 100;
  if (price >= 100000) return 50;
  if (price >= 10000) return 10;
  if (price >= 1000) return 5;
  if (price >= 100) return 1;
  if (price >= 10) return 0.1;
  if (price >= 1) return 0.01;
  return 0.001;
}

function roundToTickSize(price: number): number {
  const tick = getTickSize(price);
  return Math.floor(price / tick) * tick;
}

// 일일 손실 추적
let dailyLossTracker = {
  date: new Date().toDateString(),
  totalLoss: 0,
  isPaused: false,
};

// ============================================================
// 기술적 분석 함수들
// ============================================================

export function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.filter(c => c > 0).slice(-period);
  const losses = changes.filter(c => c < 0).slice(-period).map(Math.abs);

  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier);
  }
  return ema;
}

// 기술적 점수 계산 (AI 없이)
function getTechnicalScore(ticker: Ticker, candles: Candle[]): {
  rsi: number; ema20: number; ema50: number; buyScore: number; sellScore: number;
} {
  if (candles.length < 20) {
    return { rsi: 50, ema20: 0, ema50: 0, buyScore: 0, sellScore: 0 };
  }

  const prices = candles.map(c => c.trade_price);
  const rsi = calculateRSI(prices);
  const ema20 = calculateEMA(prices, 20);
  const ema50 = calculateEMA(prices, 50);

  let buyScore = 0;
  let sellScore = 0;

  // RSI 신호
  if (rsi < 35) buyScore += 2;
  else if (rsi > 65) sellScore += 2;

  // EMA 크로스
  if (ema20 > ema50) buyScore += 2;
  else if (ema20 < ema50) sellScore += 2;

  // 가격 vs EMA50
  if (ticker.trade_price > ema50) buyScore += 1;
  else sellScore += 1;

  // 24h 변동률
  if (ticker.signed_change_rate > 0.02) buyScore += 1;
  else if (ticker.signed_change_rate < -0.02) sellScore += 1;

  return { rsi, ema20, ema50, buyScore, sellScore };
}

// AI 분석 결과 파싱
function parseAiSignal(analysis: string): { signal: 'BUY' | 'SELL' | 'HOLD'; confidence: number } {
  const lines = analysis.split('\n');
  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 0;

  for (const line of lines) {
    const upper = line.toUpperCase().trim();
    if (upper.startsWith('SIGNAL:')) {
      if (upper.includes('BUY')) signal = 'BUY';
      else if (upper.includes('SELL')) signal = 'SELL';
      else signal = 'HOLD';
    }
    if (upper.startsWith('CONFIDENCE:')) {
      const match = line.match(/(\d+)/);
      if (match) confidence = parseInt(match[1]);
    }
  }

  return { signal, confidence };
}

// 거래 실행 (tick-size 준수, string 변환)
async function executeOrder(
  market: string,
  side: 'bid' | 'ask',
  price: number,
  volume: number,
): Promise<{ success: boolean; order?: any; error?: string }> {
  try {
    if (volume <= 0) return { success: false, error: 'Invalid volume' };

    const tickPrice = roundToTickSize(price);
    const orderAmount = tickPrice * volume;

    if (side === 'bid' && orderAmount < UPBIT_MIN_ORDER_KRW) {
      return { success: false, error: `주문금액 ${orderAmount.toFixed(0)}원 < 최소 ${UPBIT_MIN_ORDER_KRW}원` };
    }

    const response = await fetch('/api/execute-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market,
        side,
        ord_type: 'limit',
        price: tickPrice,
        volume,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error || `HTTP ${response.status}` };
    }

    const order = await response.json();
    return { success: true, order };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ============================================================
// 보유 코인 정보 추출 (Upbit 계좌 기반)
// ============================================================

interface HoldingInfo {
  currency: string;
  market: string; // KRW-XXX
  balance: number;
  avgBuyPrice: number;
  currentPrice: number;
  value: number; // 현재 평가금액
  gainPercent: number; // 수익률
}

function getHoldings(accounts: Account[], tickerMap: Map<string, Ticker>): HoldingInfo[] {
  return accounts
    .filter(a => a.currency !== 'KRW' && parseFloat(a.balance) > 0)
    .map(a => {
      const market = `KRW-${a.currency}`;
      const balance = parseFloat(a.balance);
      const avgBuyPrice = parseFloat(a.avg_buy_price);
      const ticker = tickerMap.get(market);
      const currentPrice = ticker?.trade_price || 0;
      const value = balance * currentPrice;
      const gainPercent = avgBuyPrice > 0 ? ((currentPrice - avgBuyPrice) / avgBuyPrice) * 100 : 0;

      return { currency: a.currency, market, balance, avgBuyPrice, currentPrice, value, gainPercent };
    })
    .filter(h => h.value >= 100); // 극소량 필터링
}

// ============================================================
// 백테스팅 엔진 (기존 유지)
// ============================================================

export const backtest = async (
  market: string,
  days: number = 90,
  initialBalance: number = 1000000
) => {
  try {
    const candles = await apiService.getCandles(market, 'days', days);
    if (candles.length < 20) return null;

    let balance = initialBalance;
    let position = 0;
    let entryPrice = 0;
    let trades: TradeLog[] = [];
    let wins = 0;
    let losses = 0;
    let maxDrawdown = 0;
    let peakBalance = initialBalance;

    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const rsi = calculateRSI([prev.trade_price, curr.trade_price]);

      if (position === 0 && rsi < 30) {
        entryPrice = curr.trade_price;
        position = balance / entryPrice * 0.9;
        balance = balance * 0.1;
        trades.push({
          id: `test-${i}`,
          timestamp: new Date(curr.candle_date_time_kst).getTime(),
          market, type: 'BUY', price: entryPrice, amount: position,
          reason: `RSI ${rsi.toFixed(2)} - 과매도`, status: 'executed',
        });
      } else if (position > 0) {
        const gain = (curr.trade_price - entryPrice) / entryPrice;
        const loss = gain < 0 ? Math.abs(gain) : 0;

        if (rsi > 70 || gain > 0.08 || loss > 0.03) {
          balance += position * curr.trade_price;
          trades.push({
            id: `test-${i}`,
            timestamp: new Date(curr.candle_date_time_kst).getTime(),
            market, type: 'SELL', price: curr.trade_price, amount: position,
            reason: `RSI ${rsi.toFixed(2)}${gain > 0.08 ? ' - 익절' : loss > 0.03 ? ' - 손절' : ''}`,
            status: 'executed',
          });
          if (gain > 0) wins++; else losses++;
          position = 0;
          entryPrice = 0;
        }
      }

      const currentBalance = balance + (position > 0 ? position * curr.trade_price : 0);
      if (currentBalance > peakBalance) peakBalance = currentBalance;
      const drawdown = (peakBalance - currentBalance) / peakBalance;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    const finalBalance = balance + (position > 0 ? position * candles[candles.length - 1].trade_price : 0);
    const profit = finalBalance - initialBalance;
    const profitPercent = (profit / initialBalance) * 100;

    return {
      finalBalance, profit, profitPercent,
      tradeCount: trades.length, winCount: wins, lossCount: losses,
      winRate: trades.length > 0 ? (wins / (wins + losses)) * 100 : 0,
      maxDrawdown: maxDrawdown * 100, trades,
    };
  } catch (error) {
    console.error('Backtest error:', error);
    return null;
  }
};

// ============================================================
// 4-Phase 자동 거래 루프
// ============================================================

export const startAutoTrading = async (
  riskConfig: RiskConfig = DEFAULT_RISK_CONFIG,
  onTrade: (trade: TradeLog) => void,
  interval: number = 60000,
  onAiAnalysis?: (log: AiAnalysisLog) => void,
) => {
  console.log('[AutoTrading] Starting with config:', riskConfig);

  const tradingLoop = setInterval(async () => {
    try {
      // ============================================
      // PHASE 0: PRE-FLIGHT
      // ============================================
      console.log('[Phase 0] Pre-flight checks...');

      // 1. Upbit 계좌 조회
      let accounts: Account[];
      try {
        accounts = await apiService.getAccounts();
      } catch (err) {
        console.error('[Phase 0] getAccounts failed:', err instanceof Error ? err.message : String(err));
        return;
      }

      // 2. 실제 KRW 잔고
      const krwBalance = parseFloat(accounts.find(a => a.currency === 'KRW')?.balance || '0');

      // 3. 일일 손실 한도 체크 (실제 총자산 기준)
      const today = new Date().toDateString();
      if (dailyLossTracker.date !== today) {
        dailyLossTracker = { date: today, totalLoss: 0, isPaused: false };
      }

      // 4. 마켓/티커 조회
      let markets: any[];
      try {
        markets = await apiService.getMarkets();
      } catch (err) {
        console.error('[Phase 0] getMarkets failed');
        return;
      }
      const krwMarkets = markets
        .filter((m: any) => m.market.startsWith('KRW-'))
        .slice(0, 30);

      let allTickers: Ticker[];
      try {
        allTickers = await apiService.getTickers(krwMarkets.map(m => m.market));
      } catch (err) {
        console.error('[Phase 0] getTickers failed');
        return;
      }
      const tickerMap = new Map<string, Ticker>(allTickers.map(t => [t.market, t]));

      // 5. 보유 코인 확인 (Upbit 계좌 기반)
      const holdings = getHoldings(accounts, tickerMap);
      const holdingsValue = holdings.reduce((sum, h) => sum + h.value, 0);
      const totalAssets = krwBalance + holdingsValue;

      // 일일 손실 체크 (실제 총자산 기준)
      const dailyLossPercent = totalAssets > 0 ? (dailyLossTracker.totalLoss / totalAssets) * 100 : 0;
      if (dailyLossPercent >= riskConfig.maxDailyLoss) {
        if (!dailyLossTracker.isPaused) {
          console.warn(`[Risk] Daily loss ${dailyLossPercent.toFixed(1)}% >= ${riskConfig.maxDailyLoss}%. Paused.`);
          dailyLossTracker.isPaused = true;
        }
        return;
      }

      console.log(`[Phase 0] KRW: ₩${krwBalance.toLocaleString()} | Holdings: ${holdings.length}개 (₩${holdingsValue.toLocaleString()}) | Total: ₩${totalAssets.toLocaleString()}`);

      // ============================================
      // PHASE 1: SELL 평가 (보유 코인 먼저)
      // ============================================
      console.log(`[Phase 1] Evaluating ${holdings.length} holdings for SELL...`);

      for (const holding of holdings) {
        const ticker = tickerMap.get(holding.market);
        if (!ticker) continue;

        // 1a. 손절/익절 즉시 체크
        if (holding.gainPercent >= riskConfig.takeProfitPercent || holding.gainPercent <= -riskConfig.stopLossPercent) {
          const exitReason = holding.gainPercent >= riskConfig.takeProfitPercent
            ? `익절 ${holding.gainPercent.toFixed(2)}%`
            : `손절 ${holding.gainPercent.toFixed(2)}%`;

          const result = await executeOrder(holding.market, 'ask', ticker.trade_price, holding.balance);

          const sellAmount = ticker.trade_price * holding.balance;
          const sellFee = sellAmount * (UPBIT_FEE_PERCENT / 100);
          const buyAmount = holding.avgBuyPrice * holding.balance;
          const buyFee = buyAmount * (UPBIT_FEE_PERCENT / 100);
          const profit = (sellAmount - sellFee) - (buyAmount + buyFee);

          onTrade({
            id: Date.now().toString(),
            timestamp: Date.now(),
            market: holding.market,
            type: 'SELL',
            price: ticker.trade_price,
            amount: holding.balance,
            reason: `[자동] ${exitReason}`,
            status: result.success ? 'executed' : 'failed',
            profit,
            profitPercent: holding.gainPercent,
            fee: sellFee,
            feePercent: UPBIT_FEE_PERCENT,
          });

          if (profit < 0) dailyLossTracker.totalLoss += Math.abs(profit);

          console.log(`[Phase 1] ${result.success ? 'SOLD' : 'SELL FAILED'} ${holding.market}: ${exitReason} | P&L: ₩${profit.toLocaleString()}`);
          continue;
        }

        // 1b. 기술적 지표로 SELL 검토
        let candles: Candle[];
        try {
          candles = await apiService.getCandles(holding.market, 'days', 30);
        } catch { continue; }

        const tech = getTechnicalScore(ticker, candles);

        // 기술적으로 SELL 신호가 강할 때만 AI 확인
        if (tech.sellScore >= 3) {
          let geminiResult: GeminiAnalysisResult | null = null;
          try {
            geminiResult = await geminiService.analyzeMarket(ticker, candles);
          } catch {}

          const aiSignal = geminiResult ? parseAiSignal(geminiResult.analysis) : { signal: 'HOLD' as const, confidence: 0 };

          // AI 로그
          if (onAiAnalysis && geminiResult) {
            onAiAnalysis({
              id: `ai-sell-${Date.now()}-${holding.market}`,
              timestamp: Date.now(),
              market: holding.market,
              signal: aiSignal.signal,
              analysis: geminiResult.analysis,
              rsi: tech.rsi, ema20: tech.ema20, ema50: tech.ema50,
              buyScore: tech.buyScore, sellScore: tech.sellScore,
              inputTokens: geminiResult.tokenUsage.inputTokens,
              outputTokens: geminiResult.tokenUsage.outputTokens,
              costKrw: geminiResult.cost.totalCostKrw,
              costUsd: geminiResult.cost.totalCostUsd,
              phase: 'PHASE1-SELL',
            });
          }

          // AI가 SELL 확인 + 신뢰도 50% 이상
          if (aiSignal.signal === 'SELL' && aiSignal.confidence >= 50) {
            const result = await executeOrder(holding.market, 'ask', ticker.trade_price, holding.balance);

            const sellAmount = ticker.trade_price * holding.balance;
            const sellFee = sellAmount * (UPBIT_FEE_PERCENT / 100);
            const buyAmount = holding.avgBuyPrice * holding.balance;
            const buyFee = buyAmount * (UPBIT_FEE_PERCENT / 100);
            const profit = (sellAmount - sellFee) - (buyAmount + buyFee);

            onTrade({
              id: Date.now().toString(),
              timestamp: Date.now(),
              market: holding.market,
              type: 'SELL',
              price: ticker.trade_price,
              amount: holding.balance,
              reason: `[AI SELL] 신뢰도 ${aiSignal.confidence}% | RSI:${tech.rsi.toFixed(0)} Score:S${tech.sellScore}`,
              status: result.success ? 'executed' : 'failed',
              profit,
              profitPercent: holding.gainPercent,
              fee: sellFee,
              feePercent: UPBIT_FEE_PERCENT,
              llmCostKrw: geminiResult?.cost.totalCostKrw || 0,
              llmCostUsd: geminiResult?.cost.totalCostUsd || 0,
              llmInputTokens: geminiResult?.tokenUsage.inputTokens || 0,
              llmOutputTokens: geminiResult?.tokenUsage.outputTokens || 0,
              aiAnalysis: geminiResult?.analysis || '',
            });

            if (profit < 0) dailyLossTracker.totalLoss += Math.abs(profit);
            console.log(`[Phase 1] AI SELL ${holding.market}: ${result.success ? 'OK' : 'FAILED'} | P&L: ₩${profit.toLocaleString()}`);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // ============================================
      // PHASE 2: BUY 사전 스크리닝 (AI 없이)
      // ============================================
      const currentHoldingCount = holdings.length;
      const canBuyMore = currentHoldingCount < riskConfig.maxOpenPositions;
      const maxTradeSize = totalAssets * (riskConfig.maxPositionSize / 100);

      if (!canBuyMore) {
        console.log(`[Phase 2] SKIP - 포지션 한도 도달 (${currentHoldingCount}/${riskConfig.maxOpenPositions})`);
        return;
      }
      if (krwBalance < UPBIT_MIN_ORDER_KRW) {
        console.log(`[Phase 2] SKIP - 잔고 부족 (₩${krwBalance.toLocaleString()} < ₩${UPBIT_MIN_ORDER_KRW})`);
        return;
      }
      if (maxTradeSize < UPBIT_MIN_ORDER_KRW) {
        console.log(`[Phase 2] SKIP - 주문금액 부족 (₩${maxTradeSize.toFixed(0)} < ₩${UPBIT_MIN_ORDER_KRW})`);
        return;
      }

      console.log(`[Phase 2] Screening markets... (budget: ₩${Math.min(maxTradeSize, krwBalance).toLocaleString()})`);

      // 이미 보유 중인 마켓 제외
      const heldMarkets = new Set(holdings.map(h => h.market));

      interface MarketCandidate {
        market: string;
        ticker: Ticker;
        candles: Candle[];
        tech: ReturnType<typeof getTechnicalScore>;
      }

      const candidates: MarketCandidate[] = [];

      for (const m of krwMarkets) {
        if (heldMarkets.has(m.market)) continue;
        const ticker = tickerMap.get(m.market);
        if (!ticker || ticker.trade_price <= 0) continue;

        // 주문금액 체크
        const orderKrw = Math.min(maxTradeSize, krwBalance);
        if (orderKrw < UPBIT_MIN_ORDER_KRW) continue;

        let candles: Candle[];
        try {
          candles = await apiService.getCandles(m.market, 'days', 30);
        } catch { continue; }

        if (candles.length < 20) continue;

        const tech = getTechnicalScore(ticker, candles);

        // 기술적 점수 3점 이상만 후보
        if (tech.buyScore >= 3) {
          candidates.push({ market: m.market, ticker, candles, tech });
        }

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // 점수 높은 순 정렬, 상위 3개만
      candidates.sort((a, b) => b.tech.buyScore - a.tech.buyScore);
      const topCandidates = candidates.slice(0, 3);

      console.log(`[Phase 2] ${candidates.length}개 후보 중 상위 ${topCandidates.length}개 선정: ${topCandidates.map(c => c.market).join(', ') || 'NONE'}`);

      if (topCandidates.length === 0) return;

      // ============================================
      // PHASE 3: AI 확정 매수 (후보만)
      // ============================================
      console.log(`[Phase 3] AI analysis for ${topCandidates.length} candidates...`);

      let availableKrw = krwBalance;

      for (const candidate of topCandidates) {
        // 잔고 재확인
        if (availableKrw < UPBIT_MIN_ORDER_KRW) {
          console.log(`[Phase 3] STOP - 잔고 부족 (₩${availableKrw.toLocaleString()})`);
          break;
        }

        // Gemini AI 호출
        let geminiResult: GeminiAnalysisResult | null = null;
        try {
          geminiResult = await geminiService.analyzeMarket(candidate.ticker, candidate.candles);
        } catch (err) {
          console.error(`[Phase 3] Gemini failed for ${candidate.market}`);
          continue;
        }

        const aiSignal = geminiResult ? parseAiSignal(geminiResult.analysis) : { signal: 'HOLD' as const, confidence: 0 };

        // AI 로그 (모든 결과 표시)
        if (onAiAnalysis && geminiResult) {
          onAiAnalysis({
            id: `ai-buy-${Date.now()}-${candidate.market}`,
            timestamp: Date.now(),
            market: candidate.market,
            signal: aiSignal.signal,
            analysis: geminiResult.analysis,
            rsi: candidate.tech.rsi, ema20: candidate.tech.ema20, ema50: candidate.tech.ema50,
            buyScore: candidate.tech.buyScore, sellScore: candidate.tech.sellScore,
            inputTokens: geminiResult.tokenUsage.inputTokens,
            outputTokens: geminiResult.tokenUsage.outputTokens,
            costKrw: geminiResult.cost.totalCostKrw,
            costUsd: geminiResult.cost.totalCostUsd,
            phase: 'PHASE3-BUY',
          });
        }

        // AI가 BUY + 신뢰도 60% 이상만 실행
        if (aiSignal.signal !== 'BUY' || aiSignal.confidence < 60) {
          console.log(`[Phase 3] ${candidate.market} - AI: ${aiSignal.signal} (신뢰도 ${aiSignal.confidence}%) → SKIP`);
          continue;
        }

        // 주문 금액 계산
        const orderKrw = Math.min(maxTradeSize, availableKrw);
        if (orderKrw < UPBIT_MIN_ORDER_KRW) continue;

        const price = candidate.ticker.trade_price;
        const volume = orderKrw / price;

        if (volume <= 0 || !isFinite(volume)) continue;

        // 주문 실행
        const result = await executeOrder(candidate.market, 'bid', price, volume);
        const buyFee = orderKrw * (UPBIT_FEE_PERCENT / 100);

        onTrade({
          id: Date.now().toString(),
          timestamp: Date.now(),
          market: candidate.market,
          type: 'BUY',
          price,
          amount: volume,
          reason: `[AI BUY] 신뢰도 ${aiSignal.confidence}% | RSI:${candidate.tech.rsi.toFixed(0)} B:${candidate.tech.buyScore} S:${candidate.tech.sellScore}`,
          status: result.success ? 'executed' : 'failed',
          rsi: candidate.tech.rsi,
          ema20: candidate.tech.ema20,
          ema50: candidate.tech.ema50,
          buyScore: candidate.tech.buyScore,
          sellScore: candidate.tech.sellScore,
          fee: result.success ? buyFee : 0,
          feePercent: UPBIT_FEE_PERCENT,
          llmCostKrw: geminiResult?.cost.totalCostKrw || 0,
          llmCostUsd: geminiResult?.cost.totalCostUsd || 0,
          llmInputTokens: geminiResult?.tokenUsage.inputTokens || 0,
          llmOutputTokens: geminiResult?.tokenUsage.outputTokens || 0,
          aiAnalysis: geminiResult?.analysis || '',
        });

        if (result.success) {
          availableKrw -= orderKrw;
          console.log(`[Phase 3] BUY ${candidate.market}: ₩${orderKrw.toLocaleString()} | 잔여: ₩${availableKrw.toLocaleString()}`);
        } else {
          console.warn(`[Phase 3] BUY FAILED ${candidate.market}: ${result.error}`);
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log('[Cycle Complete]');

    } catch (error) {
      console.error('Auto-trading loop error:', error instanceof Error ? error.message : String(error));
    }
  }, interval);

  return () => clearInterval(tradingLoop);
};

// 기존 함수 export 유지 (App.tsx 호환)
export const generateTradeSignal = async (ticker: Ticker, candles: Candle[]) => {
  const tech = getTechnicalScore(ticker, candles);
  return { ...tech, signal: 'HOLD' as const, geminiResult: null };
};
