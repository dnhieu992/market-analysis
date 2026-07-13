/**
 * StochRSI (TradingView defaults 14/14/3/3).
 *   %K (the "yellow" line) = SMA(smoothK) of the raw Stoch of RSI
 *   %D (its MA)            = SMA(smoothD) of %K
 * Returns full parallel arrays aligned to `closes` (NaN during warm-up).
 */
export type StochRsiSeries = { k: number[]; d: number[] };

function rsiSeries(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) g += d;
    else l -= d;
  }
  g /= period;
  l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) {
      g = (g * (period - 1) + d) / period;
      l = (l * (period - 1)) / period;
    } else {
      g = (g * (period - 1)) / period;
      l = (l * (period - 1) - d) / period;
    }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function smaSeries(values: number[], n: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) continue;
    let s = 0;
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      const v = values[j]!;
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      s += v;
    }
    if (ok) out[i] = s / n;
  }
  return out;
}

export function calculateStochRsi(
  closes: number[],
  rsiLen = 14,
  stochLen = 14,
  smoothK = 3,
  smoothD = 3,
): StochRsiSeries {
  const rsi = rsiSeries(closes, rsiLen);
  const raw: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    let ok = true;
    for (let j = i - stochLen + 1; j <= i; j++) {
      if (j < 0) {
        ok = false;
        break;
      }
      const v = rsi[j]!;
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (ok) raw[i] = hi === lo ? 0 : ((rsi[i]! - lo) / (hi - lo)) * 100;
  }
  const k = smaSeries(raw, smoothK);
  const d = smaSeries(k, smoothD);
  return { k, d };
}
