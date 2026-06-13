import { createServerApiClient } from '@web/shared/auth/api-auth';
import { DayTradingFeed } from '@web/widgets/day-trading/day-trading-feed';
import type { DayTradingSignal, DayTradingStats } from '@web/shared/api/types';

async function loadData(): Promise<{ signals: DayTradingSignal[]; stats: DayTradingStats }> {
  try {
    const api = createServerApiClient();
    const [res, stats] = await Promise.all([
      api.fetchDayTradingSignals({ limit: 50 }),
      api.fetchDayTradingStats(),
    ]);
    return { signals: res.data, stats };
  } catch {
    return {
      signals: [],
      stats: { total: 0, active: 0, tpHit: 0, slHit: 0, winRate: 0, totalPnlUsd: 0 },
    };
  }
}

export default async function DayTradingPage() {
  const { signals, stats } = await loadData();
  return <DayTradingFeed initialSignals={signals} initialStats={stats} />;
}
