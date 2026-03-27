import React, { useState, useEffect } from 'react';
import { Play, Square } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { Account, TradeLog, Ticker } from './types';
import { apiService } from './services/apiService';
import { startAutoTrading, DEFAULT_RISK_CONFIG, AiAnalysisLog } from './services/tradingService';
import { tradeStorage } from './services/tradeStorage';
import { assetHistory } from './services/assetHistory';
import { geminiService } from './services/geminiService';

export default function App() {
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [isAutoTrading, setIsAutoTrading] = useState(false);
  const [aiLogs, setAiLogs] = useState<AiAnalysisLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState<any>(null);
  const [chartType, setChartType] = useState<'line' | 'candlestick'>('line');

  useEffect(() => {
    const savedTrades = tradeStorage.loadTrades();
    setTradeLogs(savedTrades);

    fetchData();
    const interval = setInterval(() => {
      fetchData();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [marketsData, statusData] = await Promise.all([
        apiService.getMarkets(),
        apiService.getStatus(),
      ]);

      const krwMarkets = marketsData.filter((m: any) => m.market.startsWith('KRW-'));
      const top20 = krwMarkets.slice(0, 20);
      const tickersData = await apiService.getTickers(top20.map(m => m.market));
      setTickers(tickersData);
      setApiStatus(statusData);

      try {
        const accountsData = await apiService.getAccounts();
        setAccounts(accountsData);

        // 자산 변화 기록
        const krwBal = parseFloat(accountsData.find((a: any) => a.currency === 'KRW')?.balance || '0');
        const holdingsVal = tickersData
          .reduce((sum: number, ticker: Ticker) => {
            const account = accountsData.find((a: any) => a.currency === ticker.market.split('-')[1]);
            if (account) {
              return sum + (parseFloat(account.balance) * ticker.trade_price);
            }
            return sum;
          }, 0);

        assetHistory.saveSnapshot({
          timestamp: Date.now(),
          totalAssets: krwBal + holdingsVal,
          krwBalance: krwBal,
          holdingsValue: holdingsVal,
        });
      } catch (e) {
        console.log('계정 정보 조회 실패');
      }
      setLoading(false);
    } catch (err) {
      console.error('데이터 로드 실패:', err);
      setLoading(false);
    }
  };

  const handleAutoTrading = async () => {
    if (isAutoTrading) {
      setIsAutoTrading(false);
      if ((window as any).stopAutoTrading) {
        (window as any).stopAutoTrading();
      }
      return;
    }

    setIsAutoTrading(true);
    try {
      const stopAutoTrading = await startAutoTrading(DEFAULT_RISK_CONFIG, (trade) => {
        setTradeLogs(prev => [trade, ...prev]);
        tradeStorage.saveTrade(trade);
      }, 60000, (aiLog) => {
        setAiLogs(prev => [aiLog, ...prev].slice(0, 50));
      });
      (window as any).stopAutoTrading = stopAutoTrading;
    } catch (err) {
      alert('자동 매매 시작 실패: ' + (err instanceof Error ? err.message : '알 수 없는 오류'));
      setIsAutoTrading(false);
    }
  };

  // 계산
  const holdings = accounts.filter(a => a.currency !== 'KRW' && parseFloat(a.balance) > 0)
    .map(account => {
      const ticker = tickers.find(t => t.market === `KRW-${account.currency}`);
      const balance = parseFloat(account.balance);
      const avgPrice = parseFloat(account.avg_buy_price);
      const currentPrice = ticker?.trade_price || 0;
      const value = balance * currentPrice;
      const gainLoss = value - (balance * avgPrice);
      const gainLossPercent = avgPrice > 0 ? (gainLoss / (balance * avgPrice)) * 100 : 0;

      return {
        symbol: account.currency,
        balance,
        avgPrice,
        currentPrice,
        value,
        gainLoss,
        gainLossPercent
      };
    });

  const totalFees = tradeLogs.reduce((sum, t) => sum + (t.fee || 0), 0);
  const stats = {
    totalTrades: tradeLogs.length,
    totalProfit: tradeLogs.reduce((sum, t) => sum + (t.profit || 0), 0),
    totalFees: totalFees,
    winRate: tradeLogs.length > 0
      ? ((tradeLogs.filter(t => (t.profit || 0) > 0).length / tradeLogs.length) * 100).toFixed(1)
      : 0,
    llmCostKrw: tradeLogs.reduce((sum, t) => sum + (t.llmCostKrw || 0), 0),
    llmCostUsd: tradeLogs.reduce((sum, t) => sum + (t.llmCostUsd || 0), 0),
    llmTotalTokens: tradeLogs.reduce((sum, t) => sum + (t.llmInputTokens || 0) + (t.llmOutputTokens || 0), 0),
    llmCalls: tradeLogs.filter(t => (t.llmCostKrw || 0) > 0).length,
  };

  const geminiCumulative = geminiService.getCumulativeCost();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 font-mono text-sm">INITIALIZING...</p>
        </div>
      </div>
    );
  }

  const krwBalance = parseFloat(accounts.find(a => a.currency === 'KRW')?.balance || '0');
  const holdingsValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const totalAssets = krwBalance + holdingsValue;
  const holdingsGain = holdings.reduce((sum, h) => sum + (h.gainLoss || 0), 0);
  const chartData = assetHistory.getChartData();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 overflow-auto">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${isAutoTrading ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
              <span className="font-mono text-xs uppercase tracking-wide text-slate-400">
                {isAutoTrading ? 'RUNNING' : 'STOPPED'}
              </span>
            </div>
            {apiStatus && (
              <span className={`font-mono text-xs ml-3 px-2 py-1 rounded ${apiStatus.upbitConnected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                }`}>
                UPBIT {apiStatus.upbitConnected ? 'LIVE' : 'OFFLINE'}
              </span>
            )}
          </div>
          <button
            onClick={handleAutoTrading}
            className={`px-4 py-2 rounded font-mono text-xs font-bold uppercase tracking-wide flex items-center gap-2 transition-all ${isAutoTrading
              ? 'bg-red-900 hover:bg-red-800 text-red-300 border border-red-700'
              : 'bg-green-900 hover:bg-green-800 text-green-300 border border-green-700'
              }`}
          >
            {isAutoTrading ? (
              <>
                <Square size={14} /> STOP
              </>
            ) : (
              <>
                <Play size={14} /> START
              </>
            )}
          </button>
        </div>

        {/* 자산 변화 차트 */}
        {chartData.length > 0 && (
          <div className="bg-slate-800 border border-slate-700 rounded p-2 mb-2">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-mono text-xs uppercase tracking-wide text-slate-400">Asset History</h2>
              <div className="flex gap-1">
                <button
                  onClick={() => setChartType('line')}
                  className={`px-2 py-1 rounded text-xs font-mono ${chartType === 'line' ? 'bg-blue-900 text-blue-300' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                >
                  Line
                </button>
                <button
                  onClick={() => setChartType('candlestick')}
                  className={`px-2 py-1 rounded text-xs font-mono ${chartType === 'candlestick' ? 'bg-blue-900 text-blue-300' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                >
                  Candlestick
                </button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              {chartType === 'line' ? (
                <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    stroke="#475569"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    stroke="#475569"
                    label={{ value: 'Assets (₩)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#94a3b8' } }}
                    tickFormatter={(value) => `₩${(value / 1000).toFixed(0)}K`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '4px' }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(value: any) => value.toLocaleString()}
                  />
                  <Legend wrapperStyle={{ paddingTop: '10px' }} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    fill="#10b981"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={0.7}
                    name="Total"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    stroke="#475569"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    stroke="#475569"
                    label={{ value: 'Change (₩)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#94a3b8' } }}
                    tickFormatter={(value) => `₩${(value / 1000).toFixed(0)}K`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '4px' }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(value: any) => value.toLocaleString()}
                  />
                  <Legend wrapperStyle={{ paddingTop: '10px' }} />
                  <Bar dataKey="change" radius={2} isAnimationActive={false}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.isUp ? '#ef4444' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}

        {/* 4분할 메인 그리드 */}
        <div className="grid grid-cols-2 gap-2 h-[calc(100vh-450px)]">
          {/* TOP-LEFT: 상태 & 통계 */}
          <div className="bg-slate-800 border border-slate-700 rounded p-2 flex flex-col overflow-hidden">
            <div className="mb-2">
              <h2 className="font-mono text-xs uppercase tracking-wide text-slate-400 mb-2">Status & Stats</h2>
              <div className="space-y-1">
                <div>
                  <p className="font-mono text-xs text-slate-500">Total P&L</p>
                  <p className={`font-mono text-lg font-bold ${(holdingsGain + stats.totalProfit) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ₩{(holdingsGain + stats.totalProfit).toLocaleString()}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="font-mono text-xs text-slate-500">TRADES</p>
                    <p className="font-mono text-sm font-bold">{stats.totalTrades}</p>
                  </div>
                  <div>
                    <p className="font-mono text-xs text-slate-500">WIN RATE</p>
                    <p className="font-mono text-sm font-bold">{stats.winRate}%</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-700 space-y-1">
              <div>
                <p className="font-mono text-xs text-slate-500">TOTAL ASSETS</p>
                <p className="font-mono text-base font-bold">₩{totalAssets.toLocaleString()}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="font-mono text-slate-500">CASH</p>
                  <p className="font-mono font-bold">₩{krwBalance.toLocaleString()}</p>
                </div>
                <div>
                  <p className="font-mono text-slate-500">HOLDINGS</p>
                  <p className="font-mono font-bold">₩{holdingsValue.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* TOP-RIGHT: 보유 종목 */}
          <div className="bg-slate-800 border border-slate-700 rounded p-2 overflow-hidden flex flex-col">
            <h2 className="font-mono text-xs uppercase tracking-wide text-slate-400 mb-1">Holdings</h2>
            <div className="overflow-y-auto flex-1 space-y-1">
              {holdings.length === 0 ? (
                <p className="font-mono text-xs text-slate-500 py-2">NO HOLDINGS</p>
              ) : (
                holdings.map((h) => (
                  <div key={h.symbol} className="bg-slate-700 rounded p-2 text-xs">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-mono font-bold">{h.symbol}</span>
                      <span className={`font-mono font-bold ${h.gainLossPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {h.gainLossPercent >= 0 ? '+' : ''}{h.gainLossPercent.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400 font-mono">
                      <span>{h.balance.toFixed(8)}</span>
                      <span>₩{h.currentPrice.toLocaleString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* BOTTOM-LEFT: 수수료 & 비용 */}
          <div className="bg-slate-800 border border-slate-700 rounded p-2">
            <h2 className="font-mono text-xs uppercase tracking-wide text-slate-400 mb-1">Costs</h2>
            <div className="space-y-1">
              <div className="bg-slate-700 rounded p-2">
                <p className="font-mono text-xs text-slate-500 mb-1">Trading Fees</p>
                <p className="font-mono text-lg font-bold">₩{stats.totalFees.toLocaleString()}</p>
                <p className="font-mono text-xs text-slate-500 mt-1">0.1% per trade</p>
              </div>
              <div className="bg-slate-700 rounded p-2">
                <p className="font-mono text-xs text-slate-500 mb-1">LLM Cost (Gemini 3 Flash)</p>
                <p className="font-mono text-lg font-bold text-yellow-400">
                  ₩{(geminiCumulative.totalCostKrw > 0 ? geminiCumulative.totalCostKrw : stats.llmCostKrw).toFixed(2)}
                </p>
                <div className="flex justify-between mt-1">
                  <p className="font-mono text-xs text-slate-500">
                    Calls: {geminiCumulative.totalCalls > 0 ? geminiCumulative.totalCalls : stats.llmCalls}
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    {(geminiCumulative.totalInputTokens + geminiCumulative.totalOutputTokens > 0
                      ? geminiCumulative.totalInputTokens + geminiCumulative.totalOutputTokens
                      : stats.llmTotalTokens).toLocaleString()} tok
                  </p>
                </div>
                <p className="font-mono text-xs text-slate-500 mt-1">
                  ${(geminiCumulative.totalCostUsd > 0 ? geminiCumulative.totalCostUsd : stats.llmCostUsd).toFixed(6)} USD
                </p>
              </div>
            </div>
          </div>

          {/* BOTTOM-RIGHT: AI 분석 & 거래 */}
          <div className="bg-slate-800 border border-slate-700 rounded p-2 flex flex-col overflow-hidden">
            <h2 className="font-mono text-xs uppercase tracking-wide text-slate-400 mb-1">AI Analysis & Trades</h2>
            <div className="overflow-y-auto flex-1">
              {aiLogs.length === 0 && tradeLogs.length === 0 ? (
                <p className="font-mono text-xs text-slate-500 py-2">START를 누르면 AI 분석이 시작됩니다</p>
              ) : (
                <div className="space-y-1">
                  {/* AI 분석 로그 */}
                  {aiLogs.slice(0, 20).map((log) => (
                    <div key={log.id} className={`bg-slate-700 rounded p-1.5 text-xs border-l-2 ${
                      log.signal === 'BUY' ? 'border-red-500' : log.signal === 'SELL' ? 'border-green-500' : 'border-slate-500'
                    }`}>
                      <div className="flex justify-between items-center">
                        <div className="flex gap-1 items-center">
                          <span className={`font-mono font-bold px-1 rounded text-xs ${
                            log.signal === 'BUY' ? 'bg-red-900 text-red-300' :
                            log.signal === 'SELL' ? 'bg-green-900 text-green-300' :
                            'bg-slate-600 text-slate-300'
                          }`}>{log.signal}</span>
                          <span className="font-mono font-bold">{log.market.replace('KRW-', '')}</span>
                        </div>
                        <span className="font-mono text-yellow-500 text-xs">₩{log.costKrw.toFixed(2)}</span>
                      </div>
                      <p className="font-mono text-slate-400 text-xs mt-0.5 truncate">
                        {log.analysis.split('\n').find(l => l.startsWith('REASON:'))?.replace('REASON: ', '') || log.analysis.slice(0, 80)}
                      </p>
                      <div className="flex justify-between mt-0.5 text-slate-500">
                        <span className="font-mono text-xs">RSI:{log.rsi.toFixed(0)} B:{log.buyScore} S:{log.sellScore}</span>
                        <span className="font-mono text-xs">{log.inputTokens + log.outputTokens} tok</span>
                      </div>
                    </div>
                  ))}
                  {/* 실제 거래 로그 */}
                  {tradeLogs.slice(0, 8).map((log) => (
                    <div key={log.id} className="bg-slate-700 rounded p-2 text-xs border-l-2 border-yellow-500">
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex gap-2">
                          <span className="font-mono font-bold px-1 rounded bg-yellow-900 text-yellow-300 text-xs">EXEC</span>
                          <span className={`font-mono font-bold px-1 rounded ${log.type === 'BUY' ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>
                            {log.type}
                          </span>
                          <span className="font-mono font-bold">{log.market}</span>
                        </div>
                        <span className={`font-mono font-bold ${log.profit && log.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {log.profit ? (log.profit >= 0 ? '+' : '') + log.profit.toLocaleString() + ' ₩' : '—'}
                        </span>
                      </div>
                      <p className="font-mono text-slate-400 text-xs">{log.reason}</p>
                      {(log.llmCostKrw !== undefined && log.llmCostKrw > 0) && (
                        <div className="flex justify-between mt-1 pt-1 border-t border-slate-600">
                          <p className="font-mono text-xs text-yellow-500">AI: ₩{log.llmCostKrw.toFixed(2)}</p>
                          <p className="font-mono text-xs text-slate-500">{((log.llmInputTokens || 0) + (log.llmOutputTokens || 0)).toLocaleString()} tok</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
