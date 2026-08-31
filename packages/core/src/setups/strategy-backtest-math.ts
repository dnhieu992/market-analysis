/**
 * PnL math for the manual setups tracked on /strategy-backtest.
 *
 * Shared between the worker (realized numbers written when a setup closes) and the
 * API (unrealized numbers computed live for still-open setups) so an open position
 * and the same position after it closes are scored by exactly the same formula.
 */

/** The trader's real fee, one side. A round trip therefore costs twice this. */
export const SETUP_FEE_PCT_PER_SIDE = 0.05;

export type SetupDirection = 'LONG' | 'SHORT';

/**
 * Percent move from entry to exit in the direction of the trade, net of the
 * round-trip fee. Unleveraged — this is the move on the position's notional.
 */
export function computeSetupPnlPct(
  direction: SetupDirection,
  entryPrice: number,
  exitPrice: number
): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  const raw = ((exitPrice - entryPrice) / entryPrice) * 100;
  const gross = direction === 'LONG' ? raw : -raw;
  return gross - SETUP_FEE_PCT_PER_SIDE * 2;
}

/**
 * Exit expressed in units of the risk taken: +2R means the move was twice the
 * distance from entry to the stop. Fees are deliberately excluded here — R is
 * the shape of the setup, `pnlPct` is what the account actually felt.
 *
 * Returns null when entry and stop sit on the same price (no measurable risk).
 */
export function computeSetupRMultiple(
  direction: SetupDirection,
  entryPrice: number,
  stopLoss: number,
  exitPrice: number
): number | null {
  const risk = direction === 'LONG' ? entryPrice - stopLoss : stopLoss - entryPrice;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const move = direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return move / risk;
}

/**
 * Planned reward:risk of a setup before it is taken — the number that decides
 * whether the setup is worth entering at all. Null when the setup has no take
 * profit, or when entry/stop leave no risk to divide by.
 */
export function computeSetupPlannedRr(
  direction: SetupDirection,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number | null | undefined
): number | null {
  if (takeProfit == null) return null;
  const risk = direction === 'LONG' ? entryPrice - stopLoss : stopLoss - entryPrice;
  const reward = direction === 'LONG' ? takeProfit - entryPrice : entryPrice - takeProfit;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  return reward / risk;
}

/**
 * How far price still has to travel to reach the limit, as a signed percent of
 * the entry: negative means price has already passed through the level in the
 * direction that would fill it.
 */
export function computeDistanceToEntryPct(
  direction: SetupDirection,
  entryPrice: number,
  price: number
): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  const gap = direction === 'LONG' ? price - entryPrice : entryPrice - price;
  return (gap / entryPrice) * 100;
}
