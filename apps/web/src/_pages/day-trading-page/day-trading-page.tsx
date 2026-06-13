import { createServerApiClient } from '@web/shared/auth/api-auth';
import { DayTradingFeed } from '@web/widgets/day-trading/day-trading-feed';
import type { DayTradingSignal, DayTradingStats, DayTradingSettings } from '@web/shared/api/types';

const DEFAULT_SETTINGS: DayTradingSettings = {
  riskPerTrade: 2,
  minRR: 2,
  maxTradesPerDay: 5,
  maxLossesPerDay: 2,
};

async function loadData(): Promise<{
  signals: DayTradingSignal[];
  stats: DayTradingStats;
  settings: DayTradingSettings;
}> {
  try {
    const api = createServerApiClient();
    const [res, stats, settings] = await Promise.all([
      api.fetchDayTradingSignals({ limit: 50 }),
      api.fetchDayTradingStats(),
      api.fetchDayTradingSettings(),
    ]);
    return { signals: res.data, stats, settings };
  } catch {
    return {
      signals: [],
      stats: { total: 0, active: 0, tpHit: 0, slHit: 0, winRate: 0, totalPnlUsd: 0 },
      settings: DEFAULT_SETTINGS,
    };
  }
}

export default async function DayTradingPage() {
  const { signals, stats, settings } = await loadData();
  return <DayTradingFeed initialSignals={signals} initialStats={stats} initialSettings={settings} />;
}
