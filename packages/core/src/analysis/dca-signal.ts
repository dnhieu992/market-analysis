import type { PaTrend } from './small-cap-signal';
import { computeTimeframeTrend } from './small-cap-signal';
import { calculateEma } from '../indicators/ema';
import { calculateRsi } from '../indicators/rsi';
import { calcUtBotResult } from '../indicators/ut-bot';
import type { Candle } from '../types/candle';

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

/** Quality tier of a DCA score — the same 70/50/30 thresholds the dashboard renders. */
export type DcaBucket = 'safe' | 'ok' | 'risky' | 'avoid';

export function dcaQualityBucket(score: number): DcaBucket {
  if (score >= 70) return 'safe';
  if (score >= 50) return 'ok';
  if (score >= 30) return 'risky';
  return 'avoid';
}

/** OHLC series for one timeframe (parallel arrays, oldest→newest). */
export type DcaTimingSeries = { closes: number[]; highs: number[]; lows: number[] };

/**
 * The /tracking-coins DCA signal computed for a single symbol — used by the DCA
 * Ladder page to answer "is now a reasonable moment to START a DCA layer?".
 *
 * Mirrors `tracking-coin-scan.service` exactly: D1 drives the timing zone
 * (`dcaZone`) and the weekly structure drives the safety score (`computeDcaScore`).
 */
export type DcaTimingSignal = {
  zone: DcaZone;
  score: number;
  bucket: DcaBucket;
  /** D1 RSI(14). */
  rsi: number | null;
  /** D1 close is back above EMA34 (the take-profit reclaim flag). */
  ema34Above: boolean | null;
  /** % the D1 close sits above the rolling 20-day low (dip-depth gauge). */
  low20Pct: number | null;
  /** Weekly price-action trend (survival lever for the score). */
  weekTrend: PaTrend;
};

export function computeDcaTimingSignal(
  d1: DcaTimingSeries,
  w1: DcaTimingSeries,
  marketCap: number | null,
): DcaTimingSignal | null {
  if (d1.closes.length < 34) return null;

  const lastClose = d1.closes[d1.closes.length - 1]!;
  const ema34Above = lastClose > calculateEma(d1.closes, 34);
  const rsi = d1.closes.length > 14 ? calculateRsi(d1.closes, 14) : null;

  const low20 = Math.min(...d1.lows.slice(-20));
  const low20Pct = low20 > 0 ? Number((((lastClose - low20) / low20) * 100).toFixed(1)) : null;

  // ── Weekly structure for the safety score ──
  const wLastClose = w1.closes[w1.closes.length - 1] ?? 0;
  const weekTrend: PaTrend = w1.closes.length >= 20 ? computeTimeframeTrend(w1.closes, w1.highs, w1.lows) : 'Neutral';
  const wEma89Above  = w1.closes.length >= 89  ? wLastClose > calculateEma(w1.closes, 89)  : null;
  const wEma200Above = w1.closes.length >= 200 ? wLastClose > calculateEma(w1.closes, 200) : null;
  const wCandles: Candle[] = w1.closes.map((c, i) => ({ open: c, high: w1.highs[i]!, low: w1.lows[i]!, close: c }));
  const utBotW1Bullish = wCandles.length >= 2 ? (calcUtBotResult(wCandles, 10, 2)?.uptrend ?? null) : null;

  const score = computeDcaScore({ marketCap, weekTrend, wEma89Above, wEma200Above, utBotW1Bullish });
  const zone = dcaZone({ ema34Above, rsi: rsi ?? 50, low20Pct });

  return { zone, score, bucket: dcaQualityBucket(score), rsi, ema34Above, low20Pct, weekTrend };
}
