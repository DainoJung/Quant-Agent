import { Market, Ticker, Candle, Trade, Orderbook, Account, Order, Deposit, Withdraw } from '../types';

const API_BASE = '/api';

export const apiService = {
  // Markets
  getMarkets: async (): Promise<Market[]> => {
    const res = await fetch(`${API_BASE}/market/all`);
    if (!res.ok) throw new Error(`Failed to fetch markets: ${res.status} ${res.statusText}`);
    return res.json();
  },

  // Ticker
  getTickers: async (markets: string[]): Promise<Ticker[]> => {
    const res = await fetch(`${API_BASE}/ticker?markets=${markets.join(',')}`);
    if (!res.ok) throw new Error(`Failed to fetch tickers: ${res.status} ${res.statusText}`);
    return res.json();
  },

  // Candles
  getCandlesMinutes: async (market: string, unit: number, count = 200) => {
    const res = await fetch(`${API_BASE}/candles/minutes/${unit}?market=${market}&count=${count}`);
    if (!res.ok) throw new Error(`Failed to fetch candles: ${res.status} ${res.statusText}`);
    return res.json();
  },

  getCandles: async (market: string, timeframe: string, count = 200): Promise<Candle[]> => {
    const res = await fetch(`${API_BASE}/candles/${timeframe}?market=${market}&count=${count}`);
    if (!res.ok) throw new Error(`Failed to fetch candles for ${market}: ${res.status} ${res.statusText}`);
    return res.json();
  },

  // Trades
  getTrades: async (market: string, count = 50): Promise<Trade[]> => {
    const res = await fetch(`${API_BASE}/trades/ticks?market=${market}&count=${count}`);
    if (!res.ok) throw new Error(`Failed to fetch trades: ${res.status} ${res.statusText}`);
    return res.json();
  },

  // Orderbook
  getOrderbook: async (markets: string[]): Promise<Orderbook[]> => {
    const res = await fetch(`${API_BASE}/orderbook?markets=${markets.join(',')}`);
    if (!res.ok) throw new Error(`Failed to fetch orderbook: ${res.status} ${res.statusText}`);
    return res.json();
  },

  // Accounts (auth required)
  getAccounts: async (): Promise<Account[]> => {
    const res = await fetch(`${API_BASE}/accounts`);
    if (!res.ok) throw new Error('Failed to fetch accounts');
    return res.json();
  },

  // Orders
  placeOrder: async (params: any) => {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Failed to place order');
    return res.json();
  },

  getOrder: async (uuid: string) => {
    const res = await fetch(`${API_BASE}/order?uuid=${uuid}`);
    if (!res.ok) throw new Error('Failed to fetch order');
    return res.json();
  },

  getOrders: async (state?: string) => {
    const url = state ? `${API_BASE}/orders?state=${state}` : `${API_BASE}/orders`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch orders');
    return res.json();
  },

  cancelOrder: async (uuid: string) => {
    const res = await fetch(`${API_BASE}/order?uuid=${uuid}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to cancel order');
    return res.json();
  },

  // Deposits/Withdraws
  getDeposits: async () => {
    const res = await fetch(`${API_BASE}/deposits`);
    if (!res.ok) throw new Error('Failed to fetch deposits');
    return res.json();
  },

  getWithdraws: async () => {
    const res = await fetch(`${API_BASE}/withdraws`);
    if (!res.ok) throw new Error('Failed to fetch withdraws');
    return res.json();
  },

  // Status
  getStatus: async () => {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) throw new Error(`Failed to fetch status: ${res.status} ${res.statusText}`);
    return res.json();
  },

  getServerIp: async () => {
    const res = await fetch(`${API_BASE}/ip`);
    return res.json();
  },

  // Calculations
  calculatePortfolio: (accounts: Account[], tickers: Map<string, Ticker>) => {
    let totalValue = 0;
    const holdings = accounts
      .filter(acc => acc.currency !== 'KRW' && parseFloat(acc.balance) > 0)
      .map(acc => {
        const ticker = tickers.get(`KRW-${acc.currency}`);
        const balance = parseFloat(acc.balance);
        const avgPrice = parseFloat(acc.avg_buy_price);
        const value = balance * (ticker?.trade_price || 0);
        totalValue += value;
        return {
          market: `KRW-${acc.currency}`,
          balance,
          value,
          avgPrice,
          gain: value - (balance * avgPrice),
          gainPercent: avgPrice ? ((ticker?.trade_price || 0) - avgPrice) / avgPrice * 100 : 0,
        };
      });

    const krwBalance = parseFloat(accounts.find(a => a.currency === 'KRW')?.balance || '0');
    totalValue += krwBalance;

    return {
      totalValue,
      totalInvested: holdings.reduce((sum, h) => sum + h.balance * h.avgPrice, 0) + krwBalance,
      totalGain: totalValue - (holdings.reduce((sum, h) => sum + h.balance * h.avgPrice, 0) + krwBalance),
      gainPercent: 0,
      holdings,
    };
  },

  calculateTechnicalIndicators: (candles: Candle[]) => {
    if (candles.length < 50) return null;

    const prices = candles.map(c => c.trade_price).reverse();

    // RSI
    const rsi = calculateRSI(prices);

    // EMA
    const ema20 = calculateEMA(prices, 20);
    const ema50 = calculateEMA(prices, 50);

    // Bollinger Bands
    const sma20 = prices.slice(0, 20).reduce((a, b) => a + b) / 20;
    const stdDev = Math.sqrt(prices.slice(0, 20).reduce((sq, n) => sq + Math.pow(n - sma20, 2), 0) / 20);

    return {
      rsi,
      ema20,
      ema50,
      bollingerBands: {
        upper: sma20 + 2 * stdDev,
        middle: sma20,
        lower: sma20 - 2 * stdDev,
      },
      volume24h: candles.reduce((sum, c) => sum + c.candle_acc_trade_volume, 0),
    };
  },
};

function calculateRSI(prices: number[], period = 14) {
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.filter(c => c > 0).slice(-period);
  const losses = changes.filter(c => c < 0).slice(-period).map(Math.abs);

  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(prices: number[], period: number) {
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier);
  }
  return ema;
}
