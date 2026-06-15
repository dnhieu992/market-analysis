/**
 * Pullback add-on (scale-in toward the UTBot stop line) for the swing flip strategy.
 *
 * Rule (mirrors the backtest in `scripts/run-flip-pullback-backtest.ts`):
 *   - While in a trend, when the candle CLOSE comes back to within `bandPct` (1%) of the
 *     UTBot stop line, open ONE MORE position in the trend direction (bull→long, bear→short).
 *   - Re-arm: an add can only fire again after price has moved MORE than `bandPct` away from
 *     the line and then returned inside it. Max `maxAdds` (3) adds per trend leg.
 *   - All legs (base + adds) close on the next confirmed flip, then reverse.
 *
 * Backtest finding (see claude-backtest/runs/2026-06-15-pullback-addon-rule.md): the rule is
 * an amplifier whose sign depends almost entirely on keyValue — strongly net-positive at
 * kv=4 (clean trends) and net-negative at kv=2/3 (chop). We therefore only enable it when the
 * effective keyValue equals `PULLBACK_KEYVALUE`.
 */

/** Only run the add-on when the effective (resolved) keyValue equals this. */
export const PULLBACK_KEYVALUE = 4;

/** Distance from the UTBot line (in %) that arms / triggers an add. */
export const PULLBACK_BAND_PCT = 1;

/** Maximum scale-in legs per trend leg. */
export const PULLBACK_MAX_ADDS = 3;

/** The pullback add-on is gated to clean-trend configs (kv=4) per the backtest. */
export function pullbackEnabledFor(keyValue: number): boolean {
  return keyValue === PULLBACK_KEYVALUE;
}

/** Distance of the close from the UTBot stop line, as a fraction (e.g. 0.008 = 0.8%). */
export function distPctFromLine(close: number, line: number): number {
  return line !== 0 ? Math.abs(close - line) / line : Infinity;
}

export type AddOnAction = 'rearm' | 'add' | 'none';

/**
 * Decide what the pullback rule does on a candle that is ALIGNED with the current trend.
 * Faithful to the backtest branch:
 *   if (dist > band)            → 'rearm'  (price pushed away; set armed=true)
 *   else if (armed && adds<max) → 'add'    (fire a scale-in; set armed=false)
 *   else                        → 'none'
 */
export function evaluateAddOn(params: {
  close: number;
  line: number;
  armed: boolean;
  addsThisTrend: number;
  bandPct?: number;
  maxAdds?: number;
}): AddOnAction {
  const band = (params.bandPct ?? PULLBACK_BAND_PCT) / 100;
  const maxAdds = params.maxAdds ?? PULLBACK_MAX_ADDS;
  const dist = distPctFromLine(params.close, params.line);
  if (dist > band) return 'rearm';
  if (params.armed && params.addsThisTrend < maxAdds) return 'add';
  return 'none';
}
