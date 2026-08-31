import type { StrategyBacktestSetup, StrategyBacktestStatus } from '@web/shared/api/types';

/** Statuses that mean the setup filled and is now finished — the ones worth scoring. */
const SCORED: StrategyBacktestStatus[] = ['TP_HIT', 'SL_HIT', 'CLOSED'];

/**
 * Setups the trader called off because the reasoning stopped holding. They never
 * produced a result the analysis can be judged on, so they are dropped from every
 * ratio below — including the denominators. They stay on the board regardless:
 * nothing here is ever deleted.
 */
const DROPPED: StrategyBacktestStatus[] = ['INVALID'];

export type SetupStats = {
  /** Every setup ever written down, cancelled ones included. */
  planned: number;
  /** Still waiting at the limit. */
  pending: number;
  /** Filled and still running. */
  open: number;
  /** Filled and finished — the sample every ratio below is computed on. */
  scored: number;
  wins: number;
  losses: number;
  /** Null until at least one setup has been scored. */
  winRate: number | null;
  /** Setups called off as invalid. Excluded from every ratio. */
  dropped: number;
  /** Share of the still-counted setups that actually filled. Null with no sample. */
  fillRate: number | null;
  /** Sum of realized R across scored setups — the headline "was the analysis good". */
  totalR: number | null;
  avgR: number | null;
  /** Sum of realized %, i.e. the result of taking every setup at the same size. */
  totalPnlPct: number | null;
};

/**
 * Scores the board. Ratios are computed only over setups that filled *and* finished:
 * a cancelled setup never risked anything, and an open one has not resolved yet, so
 * counting either would make the win rate say something it does not mean.
 */
export function computeSetupStats(setups: StrategyBacktestSetup[]): SetupStats {
  const scoredSetups = setups.filter((s) => SCORED.includes(s.status));
  const withR = scoredSetups.filter((s) => s.rMultiple != null);
  const withPnl = scoredSetups.filter((s) => s.pnlPct != null);
  const counted = setups.filter((s) => !DROPPED.includes(s.status));
  const filledEver = counted.filter((s) => s.status !== 'PENDING');

  const wins = scoredSetups.filter((s) => (s.pnlPct ?? 0) > 0).length;
  const totalR = withR.reduce((sum, s) => sum + (s.rMultiple ?? 0), 0);

  return {
    planned: setups.length,
    pending: setups.filter((s) => s.status === 'PENDING').length,
    open: setups.filter((s) => s.status === 'ENTERED').length,
    dropped: setups.filter((s) => DROPPED.includes(s.status)).length,
    scored: scoredSetups.length,
    wins,
    losses: scoredSetups.length - wins,
    winRate: scoredSetups.length > 0 ? wins / scoredSetups.length : null,
    fillRate: counted.length > 0 ? filledEver.length / counted.length : null,
    totalR: withR.length > 0 ? totalR : null,
    avgR: withR.length > 0 ? totalR / withR.length : null,
    totalPnlPct:
      withPnl.length > 0 ? withPnl.reduce((sum, s) => sum + (s.pnlPct ?? 0), 0) : null,
  };
}
