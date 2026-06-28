import { createServerApiClient } from '@web/shared/auth/api-auth';
import { DcaLadderFeed } from '@web/widgets/dca-ladder/dca-ladder-feed';
import type { DcaLadderState } from '@web/shared/api/types';

const FALLBACK_STATE: DcaLadderState = {
  settings: {
    startCapital: 1000,
    firstTierPct: 5,
    bearFirstTierPct: 10,
    numTiers: 10,
    stepPct: 1.5,
    tpPct: 10,
    feePct: 0.05,
    enabled: false,
  },
  cycle: {
    id: '',
    cycleNumber: 0,
    status: 'FLAT',
    peak: 0,
    budget: 0,
    avgCost: null,
    positionSize: null,
    tpPrice: null,
    realizedPnl: null,
  },
  orders: [],
  livePrice: 0,
  timingSignal: null,
  summary: {
    cycleCount: 0,
    avgFillsPerCycle: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
  },
};

async function loadState(): Promise<DcaLadderState> {
  try {
    const api = createServerApiClient();
    return await api.fetchDcaLadder();
  } catch {
    return FALLBACK_STATE;
  }
}

export default async function DcaLadderPage() {
  const initialState = await loadState();
  return (
    <main className="page">
      <h1>BTC DCA Ladder</h1>
      <DcaLadderFeed initialState={initialState} />
    </main>
  );
}
