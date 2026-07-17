import { calculateEma } from '../indicators/ema';
import { calculateRsi } from '../indicators/rsi';
import { calculateStochRsi } from '../indicators/stoch-rsi';
import { computeTimeframeStructure, type PaTrend, type SwingStructure } from './small-cap-signal';

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
 *   - Bearish EMA stack (EMA34<89<200) ............ 15
 *   - Stretched below EMA34: 7–15% = 20, 5–7%/15–18% = 10
 *   - StochRSI oversold: %K<20 = 20, %K<30 = 10
 *   - StochRSI cross: fresh bullish cross in oversold = 25, about-to-cross = 12
 *   - Price action (see below) .................... 20
 *
 * ── Why a PA block, and why THESE two reads ──────────────────────────────────
 * This setup is, by construction, a LONG bought into a downtrend (price under EMA34,
 * bearish stack). So the entry timeframe's own PA trend is ~always Down and carries no
 * information — scoring it would just subtract a constant. The two PA facts that DO
 * separate a good bounce from a falling knife:
 *
 *   1. `htfTrend` (12) — the higher timeframe's trend (D1 for a 4H setup, W1 for a D1
 *      setup). A dip bought while the HTF still trends up is a pullback; the same dip
 *      under a collapsing HTF is a knife. This is the /tracking-coins alignment idea
 *      (`computeEntryScore`) applied to the bounce.
 *   2. `swingStructure` (8) — the entry timeframe's own HH/HL structure. Still printing
 *      lower lows (LH_LL) = the downtrend has not stopped; a higher low (LH_HL) = a base
 *      is forming under price, which is what a bounce needs.
 *
 * PA deliberately does NOT count toward the "at least one signal condition" gate — it is
 * context that ranks a setup, not a reason to surface a coin. A bad HTF only costs points
 * (the card still appears, it just won't clear the Telegram threshold), keeping the
 * scanner's wide-net "early monitoring" design intact.
 *
 * `stage` = 'reach' when the full strict entry is present (stack + strict distance + fresh
 * cross), else 'near' — PA does not affect the stage. Returns null when price is not below
 * EMA34 or no signal condition is met (so a plain downtrend never shows).
 */
export const EMA_STACK_SCORE_WEIGHTS = {
  stack: 15,
  distFull: 20,
  distNear: 10,
  osFull: 20,
  osNear: 10,
  crossFull: 25,
  crossNear: 12,
  /** Max points for higher-timeframe trend alignment. */
  htfTrend: 12,
  /** Max points for entry-timeframe swing structure. */
  structure: 8,
} as const;

/** Higher-timeframe PA trend → points. Bouncing WITH the bigger trend scores; against it, zero. */
export const EMA_STACK_HTF_TREND_POINTS: Record<PaTrend, number> = {
  StrongUp: 12,
  Up: 10,
  Neutral: 6,
  Down: 3,
  StrongDown: 0,
};

/** Entry-timeframe swing structure → points. Rewards a downtrend that stopped making lower lows. */
export const EMA_STACK_STRUCTURE_POINTS: Record<SwingStructure, number> = {
  HH_HL: 8, // đỉnh & đáy đều cao dần — cấu trúc đã đảo
  LH_HL: 6, // đáy cao dần, đỉnh còn thấp dần — đang nén, đáy hình thành
  Mixed: 4, // swing bằng nhau / chưa rõ
  HH_LL: 2, // biên độ mở rộng — chưa ổn định
  LH_LL: 0, // còn phá đáy — dao đang rơi
};

/** %K below this (but not below osLevel) earns partial oversold points. */
export const EMA_STACK_OS_NEAR_LEVEL = 30;

export type EmaStackScoreBreakdown = {
  stack: number;
  distance: number;
  oversold: number;
  cross: number;
  htfTrend: number;
  structure: number;
};

/** Price-action context for the PA block — the caller supplies the higher-timeframe read. */
export type EmaStackPaInput = {
  /** Entry-timeframe highs, aligned 1:1 with `closes`. */
  highs: number[];
  /** Entry-timeframe lows, aligned 1:1 with `closes`. */
  lows: number[];
  /** Higher-timeframe PA trend: D1 for a 4H setup, W1 for a D1 setup. */
  htfTrend: PaTrend;
  /** Display label of the higher timeframe, e.g. 'D1' | 'W1' — used in the reason text. */
  htfLabel: string;
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
  /** Higher-timeframe PA trend the PA block scored. */
  htfTrend: PaTrend;
  /** Display label of the timeframe `htfTrend` was read on, e.g. 'D1' | 'W1'. */
  htfLabel: string;
  /** Entry-timeframe swing structure the PA block scored. */
  swingStructure: SwingStructure;
};

/** Vietnamese trend wording for the card note. */
const PA_TREND_LABEL: Record<PaTrend, string> = {
  StrongUp: 'tăng mạnh ↑↑',
  Up: 'tăng ↑',
  Neutral: 'đi ngang →',
  Down: 'giảm ↓',
  StrongDown: 'giảm mạnh ↓↓',
};

/** Vietnamese structure wording for the card note. */
const PA_STRUCTURE_LABEL: Record<SwingStructure, string> = {
  HH_HL: 'Cấu trúc đã đảo (HH+HL)',
  LH_HL: 'Đáy cao dần — đang tạo đáy',
  Mixed: 'Cấu trúc chưa rõ',
  HH_LL: 'Biên độ mở rộng (HH+LL)',
  LH_LL: 'Còn phá đáy (LH+LL)',
};

export function scoreEmaStackOversoldSetup(
  closes: number[],
  pa: EmaStackPaInput,
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
  // below EMA34 with none of the three does not produce a card. PA is context that ranks
  // a surfaced setup, so it is deliberately excluded from this gate.
  if (distance + oversold + cross <= 0) return null;

  // ── Price action (see the doc comment above for why only these two reads) ──
  const { swingStructure } = computeTimeframeStructure(closes, pa.highs, pa.lows);
  const htfTrend = EMA_STACK_HTF_TREND_POINTS[pa.htfTrend];
  const structure = EMA_STACK_STRUCTURE_POINTS[swingStructure];

  const score = stack + distance + oversold + cross + htfTrend + structure;

  const reasons: string[] = [];
  if (stack) reasons.push('Dưới cụm EMA34<89<200');
  if (distance === W.distFull) reasons.push(`Giãn ${(distPct * 100).toFixed(1)}% (chuẩn)`);
  else if (distance === W.distNear) reasons.push(`Giãn ${(distPct * 100).toFixed(1)}%`);
  if (oversold === W.osFull) reasons.push(`Quá bán %K ${kNow.toFixed(0)}`);
  else if (oversold === W.osNear) reasons.push(`Gần quá bán %K ${kNow.toFixed(0)}`);
  if (cross === W.crossFull) reasons.push('StochRSI cắt lên');
  else if (cross === W.crossNear) reasons.push(`StochRSI sắp cắt (%D−%K ${gap.toFixed(1)})`);
  // PA reasons always show — "ngược trend D1" is exactly the warning worth reading.
  reasons.push(
    `Trend ${pa.htfLabel} ${PA_TREND_LABEL[pa.htfTrend]}${htfTrend >= W.htfTrend - 2 ? ' (thuận)' : htfTrend === 0 ? ' (ngược)' : ''}`,
  );
  reasons.push(PA_STRUCTURE_LABEL[swingStructure]);

  const isReach = stack === W.stack && distance === W.distFull && cross === W.crossFull;
  const stage: EmaStackSignalStage = isReach ? 'reach' : 'near';

  return {
    score,
    breakdown: { stack, distance, oversold, cross, htfTrend, structure },
    reasons,
    stage,
    crossed,
    aboutToCross,
    htfTrend: pa.htfTrend,
    htfLabel: pa.htfLabel,
    swingStructure,
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
 * One-line PA summary of a scored setup, for the Telegram alert. Leads with the points the
 * PA block contributed, so a "95đ but the weekly is collapsing" setup reads as what it is.
 */
export function formatEmaStackPa(setup: EmaStackScoredSetup): string {
  const pts = setup.breakdown.htfTrend + setup.breakdown.structure;
  const max = EMA_STACK_SCORE_WEIGHTS.htfTrend + EMA_STACK_SCORE_WEIGHTS.structure;
  const warn = setup.breakdown.htfTrend === 0 ? ' ⚠️' : '';
  return `PA ${pts}/${max}đ — Trend ${setup.htfLabel} ${PA_TREND_LABEL[setup.htfTrend]}${warn} · ${PA_STRUCTURE_LABEL[setup.swingStructure]}`;
}
