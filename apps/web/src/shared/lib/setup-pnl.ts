import type { TrackedSetup } from '@web/shared/api/types';

// Round-trip trading fee (0.05%/side × 2) — matches the user's real fee.
const ROUND_TRIP_FEE = 0.001;

// Assumed capital per setup for the dollar estimate (no leverage).
export const DEFAULT_CAPITAL = 1000;

export type SetupPnl = {
  /** Estimated return in percent of the entry price, net of fees. */
  pct: number;
  /** Estimated PnL in USD on DEFAULT_CAPITAL, net of fees. */
  amount: number;
  /** false when the position is still open (uses live price, not a closed level). */
  realized: boolean;
};

/**
 * Estimates a setup's PnL as a percentage price move from the entry midpoint,
 * net of the round-trip fee. Returns null for setups with no position
 * (PENDING / INVALID / EXPIRED that never filled).
 */
export function estimateSetupPnl(s: TrackedSetup): SetupPnl | null {
  const entry = (s.entryLow + s.entryHigh) / 2;
  if (!Number.isFinite(entry) || entry <= 0) return null;

  let exit: number | null;
  let realized = true;

  switch (s.status) {
    case 'TP2_HIT':
      exit = s.takeProfit2 ?? s.takeProfit1;
      break;
    case 'TP1_HIT':
      exit = s.takeProfit1;
      break;
    case 'SL_HIT':
      exit = s.stopLoss;
      break;
    case 'ENTERED':
      exit = s.lastPrice;
      realized = false;
      break;
    default:
      return null; // PENDING / INVALID / EXPIRED — never held a position
  }

  if (exit == null || !Number.isFinite(exit)) return null;

  const gross = s.direction === 'short' ? (entry - exit) / entry : (exit - entry) / entry;
  const net = gross - ROUND_TRIP_FEE;
  return { pct: net * 100, amount: net * DEFAULT_CAPITAL, realized };
}

export function formatPnlPct(pnl: SetupPnl): string {
  const sign = pnl.pct >= 0 ? '+' : '';
  const prefix = pnl.realized ? '' : '~';
  return `${prefix}${sign}${pnl.pct.toFixed(2)}%`;
}

export function formatPnlAmount(pnl: SetupPnl): string {
  const sign = pnl.amount >= 0 ? '+' : '-';
  const prefix = pnl.realized ? '' : '~';
  return `${prefix}${sign}$${Math.abs(pnl.amount).toFixed(2)}`;
}
