import { calculateEma } from '../indicators/ema';
import { calculateRsi } from '../indicators/rsi';
import { calculateStochRsi } from '../indicators/stoch-rsi';

/**
 * "Extended-below-EMA-stack oversold StochRSI bounce" entry detector (LONG only).
 *
 * Evaluated on the LAST candle of `closes`. Fires when ALL hold:
 *   1. Price below a bearish EMA stack:  close < EMA34 < EMA89 < EMA200
 *   2. Price stretched distMin..distMax below EMA34: (EMA34-close)/EMA34 ∈ [distMin, distMax]
 *   3. StochRSI (14/14/3/3) bullish cross in oversold: %K crosses above %D from below,
 *      while %K < osLevel.
 *
 * Shared by the /strategy-test backtest strategy and the worker's 4h auto-scanner so
 * both use identical maths.
 */
export type EmaStackOversoldConfig = {
  tpPct: number;      // take-profit fraction, e.g. 0.10
  distMin: number;    // min distance below EMA34, e.g. 0.07
  distMax: number;    // max distance below EMA34, e.g. 0.15
  osLevel: number;    // StochRSI oversold threshold, e.g. 20
};

export const DEFAULT_EMA_STACK_OVERSOLD_CONFIG: EmaStackOversoldConfig = {
  tpPct: 0.1,
  distMin: 0.07,
  distMax: 0.15,
  osLevel: 20,
};

/** Minimum candles needed before a signal can be evaluated (EMA200 + StochRSI warm-up). */
export const EMA_STACK_OVERSOLD_MIN_CANDLES = 200 + 14 + 14 + 3 + 3 + 2;

export type EmaStackOversoldEntry = {
  price: number;
  ema34: number;
  ema89: number;
  ema200: number;
  /** Distance below EMA34 as a fraction, e.g. 0.093 = 9.3% below. */
  distPct: number;
  rsi: number;
  stochK: number;
  stochD: number;
  /** Take-profit price = price × (1 + tpPct). */
  tpPrice: number;
};

/**
 * Returns the entry snapshot when the last candle satisfies the rule, else null.
 */
export function detectEmaStackOversoldEntry(
  closes: number[],
  config: Partial<EmaStackOversoldConfig> = {},
): EmaStackOversoldEntry | null {
  const cfg = { ...DEFAULT_EMA_STACK_OVERSOLD_CONFIG, ...config };
  if (closes.length < EMA_STACK_OVERSOLD_MIN_CANDLES) return null;

  const price = closes[closes.length - 1]!;
  const ema34 = calculateEma(closes, 34);
  const ema89 = calculateEma(closes, 89);
  const ema200 = calculateEma(closes, 200);

  // 1) price below a bearish EMA stack
  if (!(price < ema34 && ema34 < ema89 && ema89 < ema200)) return null;

  // 2) stretched distMin..distMax below EMA34
  const distPct = (ema34 - price) / ema34;
  if (distPct < cfg.distMin || distPct > cfg.distMax) return null;

  // 3) StochRSI bullish cross while oversold
  const { k, d } = calculateStochRsi(closes);
  const n = closes.length;
  const kNow = k[n - 1];
  const kPrev = k[n - 2];
  const dNow = d[n - 1];
  const dPrev = d[n - 2];
  if (
    kNow === undefined || kPrev === undefined || dNow === undefined || dPrev === undefined ||
    Number.isNaN(kNow) || Number.isNaN(kPrev) || Number.isNaN(dNow) || Number.isNaN(dPrev)
  ) {
    return null;
  }
  const crossUp = kPrev <= dPrev && kNow > dNow;
  if (!crossUp || kNow >= cfg.osLevel) return null;

  return {
    price,
    ema34,
    ema89,
    ema200,
    distPct,
    rsi: calculateRsi(closes, 14),
    stochK: kNow,
    stochD: dNow,
    tpPrice: price * (1 + cfg.tpPct),
  };
}

/**
 * "Near / reach" monitoring detector — a wider net than the strict entry above.
 *
 * The strict `detectEmaStackOversoldEntry` only fires on the exact cross candle. For the
 * /ema-bounce watchlist the user wants to ALSO surface coins that are *about to* qualify,
 * so they can eyeball the chart before deciding. This returns the best stage:
 *
 *   - `reach` — the entry actually fired: bearish EMA stack, stretched 7–15% below EMA34,
 *     and a StochRSI bullish cross in oversold happened within the last `crossLookback`
 *     candles while price has NOT yet run more than `maxRunPct` past the cross close.
 *     (The exact-cross-candle case is the strict signal.)
 *   - `near` — almost there: still under the EMA stack and inside a wider 5–18% band, and
 *     EITHER the StochRSI lines are converging about to cross up in oversold, OR they have
 *     crossed but the distance is a bit off (too shallow / a touch deep).
 *
 * Returns null when not even "near" (or when price already ran > maxRunPct past a cross —
 * a missed/late entry that isn't worth surfacing fresh).
 */
export type EmaStackSignalStage = 'near' | 'reach';

export type EmaStackNearConfig = {
  nearDistMin: number;   // widened min distance below EMA34 for "near", e.g. 0.05
  nearDistMax: number;   // widened max distance below EMA34 for "near", e.g. 0.18
  crossLookback: number; // how many recent candles back a cross still counts, e.g. 3
  maxRunPct: number;     // max run past the cross close to still count as fresh, e.g. 0.05
  crossGap: number;      // max (%D − %K) gap to count lines as "about to cross", e.g. 6
};

export const DEFAULT_EMA_STACK_NEAR_CONFIG: EmaStackNearConfig = {
  nearDistMin: 0.05,
  nearDistMax: 0.18,
  crossLookback: 3,
  maxRunPct: 0.05,
  crossGap: 6,
};

export type EmaStackOversoldSignal = EmaStackOversoldEntry & {
  stage: EmaStackSignalStage;
  /** Short Vietnamese explanation of why it's at this stage (shown on the card). */
  note: string;
  /** A StochRSI bullish cross in oversold happened within the lookback window. */
  crossed: boolean;
  /** The StochRSI lines are converging, about to cross up in oversold (no cross yet). */
  aboutToCross: boolean;
};

export function detectEmaStackOversoldSignal(
  closes: number[],
  config: Partial<EmaStackOversoldConfig & EmaStackNearConfig> = {},
): EmaStackOversoldSignal | null {
  const cfg = { ...DEFAULT_EMA_STACK_OVERSOLD_CONFIG, ...DEFAULT_EMA_STACK_NEAR_CONFIG, ...config };
  if (closes.length < EMA_STACK_OVERSOLD_MIN_CANDLES) return null;

  const price = closes[closes.length - 1]!;
  const ema34 = calculateEma(closes, 34);
  const ema89 = calculateEma(closes, 89);
  const ema200 = calculateEma(closes, 200);

  // 1) structural: still under a bearish EMA stack
  if (!(price < ema34 && ema34 < ema89 && ema89 < ema200)) return null;

  // 2) inside the WIDER near band (the strict 7–15% band is a subset of this)
  const distPct = (ema34 - price) / ema34;
  if (distPct < cfg.nearDistMin || distPct > cfg.nearDistMax) return null;

  const { k, d } = calculateStochRsi(closes);
  const n = closes.length;
  const kNow = k[n - 1];
  const kPrev = k[n - 2];
  const dNow = d[n - 1];
  const dPrev = d[n - 2];
  if (
    kNow === undefined || kPrev === undefined || dNow === undefined || dPrev === undefined ||
    Number.isNaN(kNow) || Number.isNaN(kPrev) || Number.isNaN(dNow) || Number.isNaN(dPrev)
  ) {
    return null;
  }

  // 3a) most recent bullish cross in oversold within the lookback window
  let crossIdx = -1;
  const oldest = Math.max(1, n - cfg.crossLookback);
  for (let i = n - 1; i >= oldest; i--) {
    const kc = k[i], kc0 = k[i - 1], dc = d[i], dc0 = d[i - 1];
    if (kc === undefined || kc0 === undefined || dc === undefined || dc0 === undefined) continue;
    if (kc0 <= dc0 && kc > dc && kc < cfg.osLevel) { crossIdx = i; break; }
  }
  const crossed = crossIdx >= 0;

  // 3b) lines converging, about to cross up in oversold (no confirmed cross yet)
  const gap = dNow - kNow;
  const aboutToCross =
    !crossed && kNow <= dNow && kNow >= kPrev && gap <= cfg.crossGap && kNow < cfg.osLevel;

  if (!crossed && !aboutToCross) return null;

  // Reject stale entries: a cross that already ran past maxRunPct is a missed setup.
  const runSinceCross = crossed ? (price - closes[crossIdx]!) / closes[crossIdx]! : 0;
  if (crossed && runSinceCross > cfg.maxRunPct) return null;

  const inReachDist = distPct >= cfg.distMin && distPct <= cfg.distMax;

  let stage: EmaStackSignalStage;
  let note: string;
  if (crossed && inReachDist) {
    stage = 'reach';
    const ago = n - 1 - crossIdx;
    const run = `${runSinceCross >= 0 ? '+' : ''}${(runSinceCross * 100).toFixed(1)}%`;
    note = ago === 0
      ? 'StochRSI vừa cắt lên trong vùng quá bán'
      : `Đã cắt lên ${ago} nến trước, giá ${run}`;
  } else {
    stage = 'near';
    if (crossed && !inReachDist) {
      note = distPct < cfg.distMin
        ? `Đã cắt lên nhưng mới giãn ${(distPct * 100).toFixed(1)}% (chưa đủ ${(cfg.distMin * 100).toFixed(0)}%)`
        : `Đã cắt lên, giãn ${(distPct * 100).toFixed(1)}% (hơi sâu, >${(cfg.distMax * 100).toFixed(0)}%)`;
    } else {
      note = `StochRSI sắp cắt lên (%K dưới %D ${gap.toFixed(1)} điểm), giãn ${(distPct * 100).toFixed(1)}%`;
    }
  }

  return {
    stage,
    note,
    crossed,
    aboutToCross,
    price,
    ema34,
    ema89,
    ema200,
    distPct,
    rsi: calculateRsi(closes, 14),
    stochK: kNow,
    stochD: dNow,
    tpPrice: price * (1 + cfg.tpPct),
  };
}

/**
 * Scored monitoring setup — the loosest net of all. Instead of gating on ALL conditions,
 * this surfaces any coin **below EMA34** that meets **at least one** signal condition
 * (stretched / oversold / StochRSI cross) and returns a **0–100 score** so the /ema-bounce
 * page can rank partial setups. The more of the setup is in place, the higher the score.
 *
 * Weighted points (partial credit for "gần"):
 *   - Bearish EMA stack (EMA34<89<200) ............ 20
 *   - Stretched below EMA34: 7–15% = 25, 5–7%/15–18% = 12
 *   - StochRSI oversold: %K<20 = 25, %K<30 = 12
 *   - StochRSI cross: fresh bullish cross in oversold = 30, about-to-cross = 15
 *
 * `stage` = 'reach' when the full strict entry is present (stack + strict distance + fresh
 * cross), else 'near'. Returns null when price is not below EMA34 or no signal condition
 * is met (so a plain downtrend with none of the three signals never shows).
 */
export const EMA_STACK_SCORE_WEIGHTS = {
  stack: 20,
  distFull: 25,
  distNear: 12,
  osFull: 25,
  osNear: 12,
  crossFull: 30,
  crossNear: 15,
} as const;

/** %K below this (but not below osLevel) earns partial oversold points. */
export const EMA_STACK_OS_NEAR_LEVEL = 30;

export type EmaStackScoreBreakdown = {
  stack: number;
  distance: number;
  oversold: number;
  cross: number;
};

export type EmaStackScoredSetup = EmaStackOversoldEntry & {
  /** 0–100 weighted completeness score. */
  score: number;
  breakdown: EmaStackScoreBreakdown;
  /** Short Vietnamese labels for the met conditions, for the card note. */
  reasons: string[];
  stage: EmaStackSignalStage;
  crossed: boolean;
  aboutToCross: boolean;
};

export function scoreEmaStackOversoldSetup(
  closes: number[],
  config: Partial<EmaStackOversoldConfig & EmaStackNearConfig> = {},
): EmaStackScoredSetup | null {
  const cfg = { ...DEFAULT_EMA_STACK_OVERSOLD_CONFIG, ...DEFAULT_EMA_STACK_NEAR_CONFIG, ...config };
  const W = EMA_STACK_SCORE_WEIGHTS;
  if (closes.length < EMA_STACK_OVERSOLD_MIN_CANDLES) return null;

  const price = closes[closes.length - 1]!;
  const ema34 = calculateEma(closes, 34);
  const ema89 = calculateEma(closes, 89);
  const ema200 = calculateEma(closes, 200);

  // Gate: only coins BELOW EMA34 are in this LONG-bounce universe.
  if (!(price < ema34)) return null;

  const distPct = (ema34 - price) / ema34;

  const { k, d } = calculateStochRsi(closes);
  const n = closes.length;
  const kNow = k[n - 1];
  const kPrev = k[n - 2];
  const dNow = d[n - 1];
  const dPrev = d[n - 2];
  if (
    kNow === undefined || kPrev === undefined || dNow === undefined || dPrev === undefined ||
    Number.isNaN(kNow) || Number.isNaN(kPrev) || Number.isNaN(dNow) || Number.isNaN(dPrev)
  ) {
    return null;
  }

  // Most recent bullish cross in oversold within the lookback window.
  let crossIdx = -1;
  const oldest = Math.max(1, n - cfg.crossLookback);
  for (let i = n - 1; i >= oldest; i--) {
    const kc = k[i], kc0 = k[i - 1], dc = d[i], dc0 = d[i - 1];
    if (kc === undefined || kc0 === undefined || dc === undefined || dc0 === undefined) continue;
    if (kc0 <= dc0 && kc > dc && kc < cfg.osLevel) { crossIdx = i; break; }
  }
  const crossed = crossIdx >= 0;
  const runSinceCross = crossed ? (price - closes[crossIdx]!) / closes[crossIdx]! : 0;
  const freshCross = crossed && runSinceCross <= cfg.maxRunPct;
  const gap = dNow - kNow;
  const aboutToCross =
    !freshCross && kNow <= dNow && kNow >= kPrev && gap <= cfg.crossGap && kNow < cfg.osLevel;

  // ── Weighted breakdown ──────────────────────────────────────────
  const stack = ema34 < ema89 && ema89 < ema200 ? W.stack : 0;

  let distance = 0;
  if (distPct >= cfg.distMin && distPct <= cfg.distMax) distance = W.distFull;
  else if (distPct >= cfg.nearDistMin && distPct <= cfg.nearDistMax) distance = W.distNear;

  let oversold = 0;
  if (kNow < cfg.osLevel) oversold = W.osFull;
  else if (kNow < EMA_STACK_OS_NEAR_LEVEL) oversold = W.osNear;

  let cross = 0;
  if (freshCross) cross = W.crossFull;
  else if (aboutToCross) cross = W.crossNear;

  // Need at least ONE signal condition (distance / oversold / cross) — a plain downtrend
  // below EMA34 with none of the three does not produce a card.
  if (distance + oversold + cross <= 0) return null;

  const score = stack + distance + oversold + cross;

  const reasons: string[] = [];
  if (stack) reasons.push('Dưới cụm EMA34<89<200');
  if (distance === W.distFull) reasons.push(`Giãn ${(distPct * 100).toFixed(1)}% (chuẩn)`);
  else if (distance === W.distNear) reasons.push(`Giãn ${(distPct * 100).toFixed(1)}%`);
  if (oversold === W.osFull) reasons.push(`Quá bán %K ${kNow.toFixed(0)}`);
  else if (oversold === W.osNear) reasons.push(`Gần quá bán %K ${kNow.toFixed(0)}`);
  if (cross === W.crossFull) reasons.push('StochRSI cắt lên');
  else if (cross === W.crossNear) reasons.push(`StochRSI sắp cắt (%D−%K ${gap.toFixed(1)})`);

  const isReach = stack === W.stack && distance === W.distFull && cross === W.crossFull;
  const stage: EmaStackSignalStage = isReach ? 'reach' : 'near';

  return {
    score,
    breakdown: { stack, distance, oversold, cross },
    reasons,
    stage,
    crossed,
    aboutToCross,
    price,
    ema34,
    ema89,
    ema200,
    distPct,
    rsi: calculateRsi(closes, 14),
    stochK: kNow,
    stochD: dNow,
    tpPrice: price * (1 + cfg.tpPct),
  };
}
