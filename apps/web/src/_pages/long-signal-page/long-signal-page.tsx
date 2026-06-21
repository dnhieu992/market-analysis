import { createServerApiClient } from '@web/shared/auth/api-auth';
import { LongSignalFeed } from '@web/widgets/long-signal/long-signal-feed';
import type { LongSignal, LongSignalStats, LongSignalSettings } from '@web/shared/api/types';

const DEFAULT_SETTINGS: LongSignalSettings = {
  notional: 100,
  keyValue: 1,
  atrPeriod: 10,
  tpPct: 2,
  catastropheStopPct: 5,
  entryHour: 0,
  exitHour: 8,
  leverage: 5,
  symbols: 'POLUSDT,XRPUSDT,SOLUSDT,TAOUSDT',
  mode: 'PAPER',
};

async function loadData(): Promise<{
  signals: LongSignal[];
  stats: LongSignalStats;
  settings: LongSignalSettings;
}> {
  try {
    const api = createServerApiClient();
    const [res, stats, settings] = await Promise.all([
      api.fetchLongSignals({ limit: 50 }),
      api.fetchLongSignalStats(),
      api.fetchLongSignalSettings(),
    ]);
    return { signals: res.data, stats, settings };
  } catch {
    return {
      signals: [],
      stats: { total: 0, active: 0, tpHit: 0, slHit: 0, forceClose: 0, manualClose: 0, wins: 0, winRate: 0, totalPnlUsd: 0 },
      settings: DEFAULT_SETTINGS,
    };
  }
}

export default async function LongSignalPage() {
  const { signals, stats, settings } = await loadData();
  return <LongSignalFeed initialSignals={signals} initialStats={stats} initialSettings={settings} />;
}
