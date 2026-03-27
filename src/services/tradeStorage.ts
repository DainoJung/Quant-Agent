import { TradeLog } from '../types';

const STORAGE_KEY = 'dongjun_quant_trades';
const MAX_STORAGE_ITEMS = 10000; // 최대 저장 거래 수

export const tradeStorage = {
  // 거래 이력 저장
  saveTrade: (trade: TradeLog) => {
    try {
      const trades = tradeStorage.loadTrades();
      trades.unshift(trade); // 최신 거래를 맨 앞에

      // 저장소 크기 제한
      if (trades.length > MAX_STORAGE_ITEMS) {
        trades.pop();
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
      return true;
    } catch (error) {
      console.error('Failed to save trade:', error);
      return false;
    }
  },

  // 모든 거래 이력 로드
  loadTrades: (): TradeLog[] => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to load trades:', error);
      return [];
    }
  },

  // 거래 이력 초기화
  clearTrades: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Failed to clear trades:', error);
      return false;
    }
  },

  // 거래 이력 업데이트 (종료 정보 추가)
  updateTrade: (id: string, updates: Partial<TradeLog>) => {
    try {
      const trades = tradeStorage.loadTrades();
      const index = trades.findIndex(t => t.id === id);
      if (index !== -1) {
        trades[index] = { ...trades[index], ...updates };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update trade:', error);
      return false;
    }
  },

  // CSV로 내보내기
  exportToCSV: (): string => {
    const trades = tradeStorage.loadTrades();
    if (trades.length === 0) return '';

    const headers = ['ID', '타입', '마켓', '가격', '수량', '타임스탬프', '이유', 'RSI', 'EMA20', 'EMA50', '익절가', '수익', '수익률', '보유기간', '수수료'];
    const rows = trades.map(trade => [
      trade.id,
      trade.type,
      trade.market,
      trade.price,
      trade.amount,
      new Date(trade.timestamp).toLocaleString('ko-KR'),
      trade.reason,
      trade.rsi?.toFixed(2) || '',
      trade.ema20?.toFixed(0) || '',
      trade.ema50?.toFixed(0) || '',
      trade.exitPrice?.toFixed(0) || '',
      trade.profit?.toFixed(0) || '',
      trade.profitPercent?.toFixed(2) || '',
      trade.holdDuration ? `${(trade.holdDuration / 1000 / 60).toFixed(1)}분` : '',
      trade.fee?.toFixed(0) || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  },

  // CSV 다운로드
  downloadCSV: (filename: string = 'trades.csv') => {
    const csv = tradeStorage.exportToCSV();
    if (!csv) {
      alert('내보낼 거래가 없습니다.');
      return;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },
};
