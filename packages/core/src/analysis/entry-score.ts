import type { PaTrend } from './small-cap-signal';

/**
 * Entry Score — "how low-risk is buying THIS spot coin right now?"
 *
 * Distinct from `longScore` (long-short-score.ts): that one rewards momentum
 * (StrongUp, fresh UT-Bot buy) and therefore peaks exactly when price is most
 * EXTENDED — i.e. the riskiest moment to buy. Entry Score instead rewards a
 * healthy uptrend bought during a pullback to support, where the stop sits just
 * below structure → small risk-per-unit → high R:R. Risk management first.
 *
 * Two layers:
 *  1. Hard gates (medium strictness) — if any fails the setup is "Avoid"
 *     (entryScore = 0). Keeps us out of downtrends, sub-EMA200 coins, and
 *     over-extended chases regardless of how the other factors look.
 *  2. Weighted score (0–100) — only meaningful when gates pass.
 */

export type EntryScoreParams = {
  /** D1 close distance above (or below) EMA34, in % — the pullback gauge. */
  extPct: number;
  /** D1 close above EMA200 — long-term uptrend intact. */
  ema200Above: boolean;
  /** D1 price-action trend. */
  d1Trend: PaTrend;
  /** Weekly price-action trend (scored, not gated). */
  weekTrend: PaTrend;
  /** D1 RSI(14). */
  rsi: number;
  /** D1 volume ratio vs 20-period average. */
  volMultiplier: number;
  utBotW1Bullish: boolean | null;
  utBotD1Bullish: boolean | null;
  utBotH4Bullish: boolean | null;
  /** R:R of the generated swing order; null = no valid order this scan. */
  rrRatio: number | null;
};

export type EntryScoreResult = {
  /** 0–100. 0 means a hard gate failed (do not buy). */
  entryScore: number;
  /** True when a hard gate rejected the setup. */
  gatedOut: boolean;
};

// ── Hard gates (medium) ──────────────────────────────────────────────────────
// D1 not in a downtrend · price above EMA200 (D1) · not over-extended (<18%).
// Weekly trend and UT-Bot are scored, not gated, at this strictness.
const MAX_EXT_PCT = 18;

function failsGate(p: EntryScoreParams): boolean {
  if (p.d1Trend === 'Down' || p.d1Trend === 'StrongDown') return true;
  if (!p.ema200Above) return true;
  if (p.extPct >= MAX_EXT_PCT) return true;
  return false;
}

// ── Pullback proximity (max 30) — the core of "low risk" ─────────────────────
// Closest to EMA34 (slightly below → slightly above) = tightest stop = best.
// The further price has run above EMA34, the more it costs to score here.
function pullbackScore(extPct: number): number {
  if (extPct >= -3 && extPct <= 6) return 30;  // sweet spot: hugging EMA34
  if (extPct >= -8 && extPct < -3) return 24;  // deeper dip, still in structure
  if (extPct > 6 && extPct <= 10) return 20;
  if (extPct > 10 && extPct <= 14) return 10;
  if (extPct > 14) return 4;                   // near the extension gate
  return 12;                                   // extPct < -8: trend weakening
}

// ── R:R (max 20) — reward-per-unit-of-risk, the mechanical risk lever ────────
function rrScore(rrRatio: number | null): number {
  if (rrRatio == null) return 0;               // no valid order = no-trade
  if (rrRatio >= 3) return 20;
  if (rrRatio >= 2) return 15;
  if (rrRatio >= 1.5) return 10;
  if (rrRatio >= 1) return 5;
  return 0;
}

// ── RSI cooled (max 15) — buying a cooled pullback beats chasing overbought ──
function rsiScore(rsi: number): number {
  if (rsi >= 40 && rsi <= 55) return 15;
  if (rsi > 55 && rsi <= 62) return 10;
  if (rsi >= 35 && rsi < 40) return 10;
  if (rsi > 62 && rsi <= 70) return 5;
  if (rsi >= 30 && rsi < 35) return 6;
  if (rsi > 70) return 0;
  return 3;                                    // rsi < 30
}

// ── Trend alignment W/D1/H4 (max 25) ─────────────────────────────────────────
function alignmentScore(p: EntryScoreParams): number {
  let s = 0;
  if (p.weekTrend === 'Up' || p.weekTrend === 'StrongUp') s += 8;
  else if (p.weekTrend === 'Neutral') s += 3;
  if (p.utBotW1Bullish) s += 5;
  if (p.utBotD1Bullish) s += 6;
  if (p.utBotH4Bullish) s += 6;
  return Math.min(25, s);
}

// ── Volume (max 10) — a calm pullback is healthy; a volume spike risks a top ─
function volScore(vol: number): number {
  if (vol < 1.0) return 10;
  if (vol < 1.5) return 8;
  if (vol <= 2.5) return 5;
  return 2;                                    // climactic volume = distribution risk
}

export function computeEntryScore(p: EntryScoreParams): EntryScoreResult {
  if (failsGate(p)) return { entryScore: 0, gatedOut: true };

  const raw =
    pullbackScore(p.extPct) +
    rrScore(p.rrRatio) +
    rsiScore(p.rsi) +
    alignmentScore(p) +
    volScore(p.volMultiplier);

  return { entryScore: Math.max(0, Math.min(100, Math.round(raw))), gatedOut: false };
}
