import type { PaTrend } from './small-cap-signal';

/**
 * DCA dashboard signals.
 *
 * The user's strategy: NO stop-loss, DCA into deep dips, take profit when price
 * reclaims EMA34/EMA89. Backtest verdict (claude-backtest/runs/2026-06-26-dca-dip-d1-no-sl):
 * it works on coins that SURVIVE and mean-revert, but is ruinous on coins that
 * die or trend down for years. So the #1 risk lever is COIN SELECTION, not timing.
 *
 * `computeDcaScore` = "how safe is it to DCA this coin?" — the defence that
 * replaces a stop-loss. The two levers the user chose: market cap (death risk)
 * and weekly trend (long-term structure still alive).
 *
 * `dcaZone` = the per-day action: GOM (add a layer) / CHO (wait) / CHOT (take profit).
 */

export type DcaZone = 'GOM' | 'CHO' | 'CHOT';

export type DcaScoreParams = {
  marketCap: number | null;
  weekTrend: PaTrend;
  wEma89Above: boolean | null;
  wEma200Above: boolean | null;
  utBotW1Bullish: boolean | null;
};

const TREND_PTS: Record<PaTrend, number> = {
  StrongUp: 20,
  Up: 15,
  Neutral: 8,
  Down: 2,
  StrongDown: 0,
};

export function computeDcaScore(p: DcaScoreParams): number {
  // ── Market cap (max 50) — bigger = far lower chance of going to zero ──
  const mc = p.marketCap ?? 0;
  let cap: number;
  if (mc >= 1_000_000_000) cap = 50;
  else if (mc >= 300_000_000) cap = 40;
  else if (mc >= 100_000_000) cap = 30;
  else if (mc >= 30_000_000) cap = 20;
  else if (mc >= 10_000_000) cap = 10;
  else cap = 0; // micro-cap or unknown = high death risk → never "safe to DCA"

  // ── Weekly structure (max 50) — long-term trend alive = will recover ──
  let wk = TREND_PTS[p.weekTrend];
  if (p.wEma200Above) wk += 15;
  if (p.wEma89Above) wk += 8;
  if (p.utBotW1Bullish) wk += 7;
  wk = Math.min(50, wk);

  return Math.max(0, Math.min(100, cap + wk));
}

export type DcaZoneParams = {
  /** D1 price is back above EMA34 (the take-profit reclaim). */
  ema34Above: boolean;
  /** D1 RSI(14). */
  rsi: number;
  /** % the close sits above the rolling 20-day low; null when unknown. */
  low20Pct: number | null;
};

export function dcaZone(p: DcaZoneParams): DcaZone {
  if (p.ema34Above) return 'CHOT'; // reclaimed EMA34 → take profit
  if (p.rsi <= 35 && p.low20Pct != null && p.low20Pct <= 8) return 'GOM'; // oversold near 20d low → add
  return 'CHO'; // below EMA34 but not yet in the add zone → wait
}
