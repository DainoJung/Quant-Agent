export interface Market {
  market: string;
  korean_name: string;
  english_name: string;
}

export interface Ticker {
  market: string;
  trade_price: number;
  opening_price: number;
  high_price: number;
  low_price: number;
  signed_change_rate: number;
  change_price: number;
  trade_volume: number;
  acc_trade_price_24h: number;
  acc_trade_volume_24h: number;
  timestamp: number;
}

export interface Candle {
  market: string;
  candle_date_time_kst: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  timestamp: number;
  candle_acc_trade_volume: number;
}

export interface Trade {
  market: string;
  trade_price: number;
  trade_volume: number;
  ask_bid: string;
  timestamp: number;
}

export interface OrderbookUnit {
  ask_price: number;
  bid_price: number;
  ask_size: number;
  bid_size: number;
}

export interface Orderbook {
  market: string;
  timestamp: number;
  orderbook_units: OrderbookUnit[];
}

export interface Account {
  currency: string;
  balance: string;
  locked: string;
  avg_buy_price: string;
}

export interface Order {
  uuid: string;
  side: 'ask' | 'bid';
  state: string;
  market: string;
  price: number;
  avg_price: number;
  executed_volume: number;
}

export interface Deposit {
  type: string;
  uuid: string;
  currency: string;
  net_type: string;
  txid: string;
  state: string;
  created_at: string;
  completed_at: string;
  amount: string;
  fee: string;
}

export interface Withdraw {
  type: string;
  uuid: string;
  currency: string;
  net_type: string;
  txid: string;
  state: string;
  created_at: string;
  completed_at: string;
  amount: string;
  fee: string;
}

export interface TradeLog {
  id: string;
  timestamp: number;
  market: string;
  type: 'BUY' | 'SELL';
  price: number;
  amount: number;
  reason: string;
  status: 'pending' | 'executed' | 'failed';
  // 거래 신호 분석 정보
  rsi?: number;
  ema20?: number;
  ema50?: number;
  buyScore?: number;
  sellScore?: number;
  // 거래 성과 추적
  exitPrice?: number;
  profit?: number;
  profitPercent?: number;
  holdDuration?: number; // 밀리초
  exitReason?: string;
  // 수수료 및 비용 추적
  fee?: number; // 업비트 수수료 (KRW)
  feePercent?: number; // 수수료율 (%)
  // LLM 비용 추적
  llmCostKrw?: number; // Gemini 호출 비용 (KRW)
  llmCostUsd?: number; // Gemini 호출 비용 (USD)
  llmInputTokens?: number;
  llmOutputTokens?: number;
  aiAnalysis?: string; // AI 분석 결과
}
