import { Ticker, Candle } from '../types';

// Gemini 3 Flash Preview 가격 (USD per 1M tokens)
const GEMINI_PRICING = {
  inputPerMillion: 0.10,   // $0.10/1M input tokens
  outputPerMillion: 0.40,  // $0.40/1M output tokens
};

const USD_TO_KRW = 1500;

export interface GeminiAnalysisResult {
  analysis: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost: {
    inputCostUsd: number;
    outputCostUsd: number;
    totalCostUsd: number;
    totalCostKrw: number;
  };
}

// 누적 비용 추적
let cumulativeCost = {
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCostUsd: 0,
  totalCostKrw: 0,
};

export const geminiService = {
  // 시장 분석 요청
  async analyzeMarket(ticker: Ticker, candles: Candle[]): Promise<GeminiAnalysisResult> {
    try {
      const prices = candles.slice(0, 14).map(c => ({
        date: c.candle_date_time_kst,
        open: c.opening_price,
        high: c.high_price,
        low: c.low_price,
        close: c.trade_price,
        volume: c.candle_acc_trade_volume,
      }));

      const response = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: ticker.market,
          currentPrice: ticker.trade_price,
          changeRate: ticker.signed_change_rate,
          volume24h: ticker.acc_trade_volume_24h,
          prices,
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();

      // 비용 계산
      const inputTokens = data.tokenUsage?.inputTokens || 0;
      const outputTokens = data.tokenUsage?.outputTokens || 0;
      const inputCostUsd = (inputTokens / 1_000_000) * GEMINI_PRICING.inputPerMillion;
      const outputCostUsd = (outputTokens / 1_000_000) * GEMINI_PRICING.outputPerMillion;
      const totalCostUsd = inputCostUsd + outputCostUsd;
      const totalCostKrw = totalCostUsd * USD_TO_KRW;

      // 누적 비용 업데이트
      cumulativeCost.totalCalls++;
      cumulativeCost.totalInputTokens += inputTokens;
      cumulativeCost.totalOutputTokens += outputTokens;
      cumulativeCost.totalCostUsd += totalCostUsd;
      cumulativeCost.totalCostKrw += totalCostKrw;

      console.log(
        `[Gemini] ${ticker.market} | Tokens: ${inputTokens}in/${outputTokens}out | Cost: $${totalCostUsd.toFixed(6)} (₩${totalCostKrw.toFixed(2)}) | Session Total: $${cumulativeCost.totalCostUsd.toFixed(6)} (₩${cumulativeCost.totalCostKrw.toFixed(2)})`
      );

      return {
        analysis: data.analysis || '',
        tokenUsage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        cost: {
          inputCostUsd,
          outputCostUsd,
          totalCostUsd,
          totalCostKrw,
        },
      };
    } catch (error) {
      console.error('[Gemini] Analysis failed:', error);
      return {
        analysis: '',
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, totalCostKrw: 0 },
      };
    }
  },

  // 누적 비용 조회
  getCumulativeCost() {
    return { ...cumulativeCost };
  },

  // 비용 리셋
  resetCost() {
    cumulativeCost = {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      totalCostKrw: 0,
    };
  },
};
