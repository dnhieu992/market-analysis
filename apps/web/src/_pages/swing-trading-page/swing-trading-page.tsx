import { createServerApiClient } from '@web/shared/auth/api-auth';
import { SwingTradingFeed } from '@web/widgets/swing-trading/swing-trading-feed';
import type { SwingTradingSignal, SwingTradingStats, SwingTradingSettings } from '@web/shared/api/types';

const DEFAULT_SETTINGS: SwingTradingSettings = {
  symbol: 'ETHUSDT',
  timeframe: '4h',
  atrPeriod: 10,
  keyValue: 2,
  riskPerTrade: 1000,
  leverage: 1,
  mode: 'PAPER',
};

async function loadData(): Promise<{
  signals: SwingTradingSignal[];
  stats: SwingTradingStats;
  settings: SwingTradingSettings;
}> {
  try {
    const api = createServerApiClient();
    const [res, stats, settings] = await Promise.all([
      api.fetchSwingTradingSignals({ limit: 50 }),
      api.fetchSwingTradingStats(),
      api.fetchSwingTradingSettings(),
    ]);
    return { signals: res.data, stats, settings };
  } catch {
    return {
      signals: [],
      stats: { total: 0, active: 0, wins: 0, losses: 0, winRate: 0, totalPnlUsd: 0 },
      settings: DEFAULT_SETTINGS,
    };
  }
}

export default async function SwingTradingPage() {
  const { signals, stats, settings } = await loadData();
  return <SwingTradingFeed initialSignals={signals} initialStats={stats} initialSettings={settings} />;
}
