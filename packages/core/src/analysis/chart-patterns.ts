/**
 * Chart-pattern detectors for the /pattern-scanner page.
 *
 * Pure functions over an OHLC series (oldest → newest). Each detector finds the most
 * RECENT qualifying formation and reports its key levels (neckline, measured-move target,
 * structural stop) plus whether the neckline has already broken (`confirmed`) or the
 * pattern is still `forming`. Detection is based on confirmed fractal pivots.
 *
 * To stay meaningful (not "everything matches everything") each pattern additionally
 * requires its defining extreme to sit at a LOCAL extreme of the recent window — a double
 * bottom must bottom near the recent low, a head-&-shoulders top must top near the recent
 * high — and to be still actionable (not already run far past the neckline, not invalidated).
 *
 * Patterns:
 *  - double_bottom            (bullish reversal) — two ~equal lows + a neckline high between
 *  - double_top               (bearish reversal) — two ~equal highs + a neckline low between
 *  - inverse_head_shoulders   (bullish reversal) — low-low-low with the middle (head) lowest
 *  - head_shoulders           (bearish reversal) — high-high-high with the middle (head) highest
 */

export type PatternKind = 'double_bottom' | 'double_top' | 'head_shoulders' | 'inverse_head_shoulders';

export const ALL_PATTERNS: PatternKind[] = ['double_bottom', 'double_top', 'head_shoulders', 'inverse_head_shoulders'];

export type PatternSeries = {
  /** Highs, oldest → newest. */
  highs: number[];
  /** Lows, parallel to highs. */
  lows: number[];
  /** Closes, parallel to highs. */
  closes: number[];
};

export type PatternPivot = { idx: number; price: number; role: string };

export type PatternMatch = {
  pattern: PatternKind;
  direction: 'bullish' | 'bearish';
  /** 'confirmed' = neckline already broken in the pattern's direction; 'forming' = not yet. */
  status: 'forming' | 'confirmed';
  /** Neckline price level (the breakout trigger). */
  neckline: number;
  /** Measured-move target off the neckline. */
  target: number;
  /** Structural invalidation level. */
  stop: number;
  /** Pattern amplitude as % of the base (bigger = more significant). */
  heightPct: number;
  /** Bars since the completing pivot (smaller = fresher). */
  barsAgo: number;
  /** The defining pivots (bottoms/tops/head/shoulders) with their role. */
  pivots: PatternPivot[];
};

export type PatternConfig = {
  /** Fractal wing — candles required on each side to confirm a pivot. */
  wing: number;
  /** Max % difference for two lows/highs (or the two shoulders) to count as "equal". */
  tolPct: number;
  /** Min pattern amplitude (neckline → extreme) as % of the base. */
  minHeightPct: number;
  /** Min bars between the two defining extremes. */
  minGap: number;
  /** Max bars between the two defining extremes. */
  maxGap: number;
  /** The completing pivot must be within this many bars of the last candle. */
  recencyBars: number;
  /** Skip if price has already run more than this % past the neckline (stale breakout). */
  maxBreakoutPct: number;
};

export const DEFAULT_PATTERN_CONFIG: PatternConfig = {
  wing: 5, // pivot = lower/higher than 5 candles each side (double-bottom rule, N=5)
  tolPct: 3, // two bottoms/tops "equal" within 3% (crypto tolerance)
  minHeightPct: 5, // neckline ≥ 5% above/below the base
  minGap: 10, // at least 10 candles between the two defining extremes
  maxGap: 60, // at most 60 candles between them
  recencyBars: 25,
  maxBreakoutPct: 4,
};

type Pivot = { idx: number; price: number; kind: 'high' | 'low' };

/** Confirmed fractal pivots (a pivot at i is known only at i+wing), sorted by index. */
function findPivots(s: PatternSeries, wing: number): Pivot[] {
  const out: Pivot[] = [];
  const n = s.highs.length;
  for (let i = wing; i < n - wing; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      if (s.highs[j]! >= s.highs[i]!) isHigh = false;
      if (s.lows[j]! <= s.lows[i]!) isLow = false;
    }
    if (isHigh) out.push({ idx: i, price: s.highs[i]!, kind: 'high' });
    if (isLow) out.push({ idx: i, price: s.lows[i]!, kind: 'low' });
  }
  return out.sort((a, b) => a.idx - b.idx);
}

const near = (a: number, b: number, tolPct: number) => Math.abs(a - b) / Math.min(a, b) <= tolPct / 100;

/** Lowest low / highest high over [from, to] inclusive. */
function localRange(s: PatternSeries, from: number, to: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = Math.max(0, from); i <= to; i++) {
    if (s.lows[i]! < min) min = s.lows[i]!;
    if (s.highs[i]! > max) max = s.highs[i]!;
  }
  return { min, max };
}

// ── Double bottom / double top ──────────────────────────────────────────────

function detectDouble(s: PatternSeries, cfg: PatternConfig, kind: 'bottom' | 'top'): PatternMatch | null {
  const isBottom = kind === 'bottom';
  const piv = findPivots(s, cfg.wing);
  const extremes = piv.filter((p) => p.kind === (isBottom ? 'low' : 'high'));
  const lastIdx = s.closes.length - 1;
  const lastClose = s.closes[lastIdx]!;

  for (let b = extremes.length - 1; b >= 1; b--) {
    const P2 = extremes[b]!;
    if (lastIdx - P2.idx > cfg.recencyBars) break; // nothing newer qualifies either
    for (let a = b - 1; a >= 0; a--) {
      const P1 = extremes[a]!;
      const gap = P2.idx - P1.idx;
      if (gap < cfg.minGap) continue;
      if (gap > cfg.maxGap) break;
      if (!near(P1.price, P2.price, cfg.tolPct)) continue;

      // neckline = the strongest opposite pivot strictly between the two extremes
      const between = piv.filter((p) => p.idx > P1.idx && p.idx < P2.idx && p.kind === (isBottom ? 'high' : 'low'));
      if (between.length === 0) continue;
      const neckline = isBottom ? Math.max(...between.map((p) => p.price)) : Math.min(...between.map((p) => p.price));

      const extreme = isBottom ? Math.min(P1.price, P2.price) : Math.max(P1.price, P2.price);
      const heightPct = (Math.abs(neckline - extreme) / extreme) * 100;
      if (heightPct < cfg.minHeightPct) continue;

      // The two extremes must sit at the LOCAL extreme of the surrounding window —
      // otherwise any two ~equal swings mid-range would qualify.
      const { min, max } = localRange(s, P1.idx - cfg.maxGap, P2.idx);
      if (isBottom && extreme > min * (1 + cfg.tolPct / 100)) continue;
      if (!isBottom && extreme < max * (1 - cfg.tolPct / 100)) continue;

      // Not invalidated: price hasn't decisively closed beyond the base since P2.
      if (isBottom && lastClose < extreme * 0.99) continue;
      if (!isBottom && lastClose > extreme * 1.01) continue;

      // Not a stale breakout that already ran far past the neckline.
      const runPct = isBottom ? ((lastClose - neckline) / neckline) * 100 : ((neckline - lastClose) / neckline) * 100;
      if (runPct > cfg.maxBreakoutPct) continue;

      const confirmed = isBottom ? lastClose > neckline : lastClose < neckline;
      const target = isBottom ? neckline + (neckline - extreme) : neckline - (extreme - neckline);
      const stop = isBottom ? extreme * 0.995 : extreme * 1.005;

      return {
        pattern: isBottom ? 'double_bottom' : 'double_top',
        direction: isBottom ? 'bullish' : 'bearish',
        status: confirmed ? 'confirmed' : 'forming',
        neckline, target, stop,
        heightPct: Number(heightPct.toFixed(1)),
        barsAgo: lastIdx - P2.idx,
        pivots: [
          { idx: P1.idx, price: P1.price, role: isBottom ? 'bottom-1' : 'top-1' },
          { idx: P2.idx, price: P2.price, role: isBottom ? 'bottom-2' : 'top-2' },
        ],
      };
    }
  }
  return null;
}

// ── Head & shoulders / inverse head & shoulders ─────────────────────────────

function detectHeadShoulders(s: PatternSeries, cfg: PatternConfig, inverse: boolean): PatternMatch | null {
  const piv = findPivots(s, cfg.wing);
  // Top H&S: shoulders/head are HIGHS, neckline troughs are LOWS. Inverse swaps.
  const mainKind: 'high' | 'low' = inverse ? 'low' : 'high';
  const extremes = piv.filter((p) => p.kind === mainKind);
  const troughs = piv.filter((p) => p.kind !== mainKind);
  const lastIdx = s.closes.length - 1;
  const lastClose = s.closes[lastIdx]!;
  if (extremes.length < 3) return null;

  for (let k = extremes.length - 1; k >= 2; k--) {
    const RS = extremes[k]!;
    if (lastIdx - RS.idx > cfg.recencyBars) break;
    for (let j = k - 1; j >= 1; j--) {
      const H = extremes[j]!;
      for (let i = j - 1; i >= 0; i--) {
        const LS = extremes[i]!;
        if (RS.idx - LS.idx > cfg.maxGap * 2) break;

        // Head is the true extreme; shoulders ~equal (tight) and clearly inside the head.
        const headIsExtreme = inverse ? H.price < LS.price && H.price < RS.price : H.price > LS.price && H.price > RS.price;
        if (!headIsExtreme) continue;
        if (!near(LS.price, RS.price, cfg.tolPct)) continue;

        // Time symmetry: shoulders roughly equidistant from the head (a real H&S trait,
        // not three random pivots). |left-span − right-span| ≤ 50% of the total span.
        const leftSpan = H.idx - LS.idx;
        const rightSpan = RS.idx - H.idx;
        if (Math.abs(leftSpan - rightSpan) > 0.5 * (RS.idx - LS.idx)) continue;

        // Neckline = the two reaction troughs (LS→H and H→RS).
        const t1 = troughs.filter((p) => p.idx > LS.idx && p.idx < H.idx);
        const t2 = troughs.filter((p) => p.idx > H.idx && p.idx < RS.idx);
        if (t1.length === 0 || t2.length === 0) continue;
        const trough1 = inverse ? Math.max(...t1.map((p) => p.price)) : Math.min(...t1.map((p) => p.price));
        const trough2 = inverse ? Math.max(...t2.map((p) => p.price)) : Math.min(...t2.map((p) => p.price));
        const neckline = (trough1 + trough2) / 2;

        const heightPct = (Math.abs(H.price - neckline) / neckline) * 100;
        if (heightPct < cfg.minHeightPct) continue;

        // Shoulders must sit BETWEEN the neckline and the head, at a MEANINGFUL depth:
        // 15–70% of the head's depth. Too shallow = flat noise; too deep = not a shoulder.
        const headDepth = Math.abs(H.price - neckline);
        const lsDepth = Math.abs(LS.price - neckline);
        const rsDepth = Math.abs(RS.price - neckline);
        const shoulderInside = inverse
          ? LS.price < neckline && RS.price < neckline && LS.price > H.price && RS.price > H.price
          : LS.price > neckline && RS.price > neckline && LS.price < H.price && RS.price < H.price;
        if (!shoulderInside) continue;
        const depthOk = (d: number) => d >= 0.15 * headDepth && d <= 0.7 * headDepth;
        if (!depthOk(lsDepth) || !depthOk(rsDepth)) continue;

        // Head must be the local extreme of its span.
        const { min, max } = localRange(s, LS.idx, RS.idx);
        if (inverse && H.price > min * (1 + cfg.tolPct / 100)) continue;
        if (!inverse && H.price < max * (1 - cfg.tolPct / 100)) continue;

        const runPct = inverse ? ((lastClose - neckline) / neckline) * 100 : ((neckline - lastClose) / neckline) * 100;
        if (runPct > cfg.maxBreakoutPct) continue;

        const confirmed = inverse ? lastClose > neckline : lastClose < neckline;
        const target = inverse ? neckline + (neckline - H.price) : neckline - (H.price - neckline);
        const stop = inverse ? H.price * 0.995 : H.price * 1.005;

        return {
          pattern: inverse ? 'inverse_head_shoulders' : 'head_shoulders',
          direction: inverse ? 'bullish' : 'bearish',
          status: confirmed ? 'confirmed' : 'forming',
          neckline, target, stop,
          heightPct: Number(heightPct.toFixed(1)),
          barsAgo: lastIdx - RS.idx,
          pivots: [
            { idx: LS.idx, price: LS.price, role: 'left-shoulder' },
            { idx: H.idx, price: H.price, role: 'head' },
            { idx: RS.idx, price: RS.price, role: 'right-shoulder' },
          ],
        };
      }
    }
  }
  return null;
}

/** Run the selected detectors over a series; returns one match per pattern that fires. */
export function scanChartPatterns(
  series: PatternSeries,
  patterns: PatternKind[],
  cfg: Partial<PatternConfig> = {},
): PatternMatch[] {
  const c = { ...DEFAULT_PATTERN_CONFIG, ...cfg };
  if (series.closes.length < c.wing * 2 + c.minGap + 2) return [];
  const out: PatternMatch[] = [];
  for (const p of patterns) {
    let m: PatternMatch | null = null;
    if (p === 'double_bottom') m = detectDouble(series, c, 'bottom');
    else if (p === 'double_top') m = detectDouble(series, c, 'top');
    else if (p === 'head_shoulders') m = detectHeadShoulders(series, c, false);
    else if (p === 'inverse_head_shoulders') m = detectHeadShoulders(series, c, true);
    if (m) out.push(m);
  }
  return out;
}
