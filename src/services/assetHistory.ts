export interface AssetSnapshot {
  timestamp: number;
  totalAssets: number;
  krwBalance: number;
  holdingsValue: number;
}

const STORAGE_KEY = 'dongjun_quant_asset_history';
const MAX_HISTORY_ITEMS = 144; // 10초마다 저장 = 24시간

export const assetHistory = {
  // 자산 스냅샷 저장
  saveSnapshot: (snapshot: AssetSnapshot) => {
    try {
      const history = assetHistory.loadHistory();
      history.unshift(snapshot);

      // 저장소 크기 제한
      if (history.length > MAX_HISTORY_ITEMS) {
        history.pop();
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      return true;
    } catch (error) {
      console.error('Failed to save asset snapshot:', error);
      return false;
    }
  },

  // 모든 자산 이력 로드
  loadHistory: (): AssetSnapshot[] => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to load asset history:', error);
      return [];
    }
  },

  // 자산 이력 초기화
  clearHistory: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Failed to clear asset history:', error);
      return false;
    }
  },

  // 차트용 데이터 포맷
  getChartData: () => {
    const history = assetHistory.loadHistory();
    const reversed = history.reverse();
    return reversed.map((item, index) => {
      const prevValue = index > 0 ? reversed[index - 1].totalAssets : item.totalAssets;
      const currentValue = item.totalAssets;
      const change = currentValue - prevValue;

      return {
        time: new Date(item.timestamp).toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        total: Math.round(currentValue),
        change: Math.round(change),
        isUp: change >= 0,
        timestamp: item.timestamp,
      };
    });
  },
};
