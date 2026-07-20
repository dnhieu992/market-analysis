/**
 * QQE — Quantitative Qualitative Estimation (Igor Livshin).
 *
 * Smooths RSI with an EMA (`rsiMa`, the fast line) then builds a Wilder-ATR-based
 * trailing stop line (`signal`, aka FastAtrRsiTL — the "QQE signal" line). A cross
 * of `rsiMa` above the signal line is a long trigger, below is a short trigger.
 * Both series are on the RSI 0–100 scale.
 *
 * Returns parallel arrays aligned 1:1 with `closes` (NaN during warm-up).
 */
export type QqeSeries = { rsiMa: number[]; signal: number[] };

/** Wilder-smoothed RSI as a full series aligned to `closes` (NaN before warm-up). */
function wilderRsiSeries(closes: number[], period: number): number[] {
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

/** Running EMA that skips leading NaNs and seeds on the first finite value. */
function emaFrom(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  const alpha = 2 / (period + 1);
  let ema = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v == null || Number.isNaN(v)) continue;
    ema = Number.isNaN(ema) ? v : alpha * v + (1 - alpha) * ema;
    out[i] = ema;
  }
  return out;
}

export function calculateQqe(
  closes: number[],
  rsiPeriod = 14,
  smoothingFactor = 5,
  qqeFactor = 4.236,
): QqeSeries {
  const n = closes.length;
  const rsiMa = emaFrom(wilderRsiSeries(closes, rsiPeriod), smoothingFactor);
  const wildersPeriod = rsiPeriod * 2 - 1;

  // ATR of the smoothed RSI, then double-smoothed and scaled → the band delta (dar).
  const atrRsi: number[] = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    if (!Number.isNaN(rsiMa[i]!) && !Number.isNaN(rsiMa[i - 1]!)) {
      atrRsi[i] = Math.abs(rsiMa[i - 1]! - rsiMa[i]!);
    }
  }
  const dar = emaFrom(emaFrom(atrRsi, wildersPeriod), wildersPeriod).map((v) =>
    Number.isNaN(v) ? NaN : v * qqeFactor,
  );

  const longband: number[] = new Array(n).fill(NaN);
  const shortband: number[] = new Array(n).fill(NaN);
  const signal: number[] = new Array(n).fill(NaN);
  let trend = 1; // 1 = up (follow longband), -1 = down (follow shortband)
  let prev = -1; // index of the last bar with a computed band

  for (let i = 0; i < n; i++) {
    const rm = rsiMa[i]!;
    const d = dar[i]!;
    if (Number.isNaN(rm) || Number.isNaN(d)) continue;

    const newLong = rm - d;
    const newShort = rm + d;

    if (prev < 0) {
      longband[i] = newLong;
      shortband[i] = newShort;
      trend = 1;
      signal[i] = longband[i]!;
      prev = i;
      continue;
    }

    const pLong = longband[prev]!;
    const pShort = shortband[prev]!;
    const pRm = rsiMa[prev]!;

    // Trailing: hold the band while price stays on its side, else reset.
    longband[i] = pRm > pLong && rm > pLong ? Math.max(pLong, newLong) : newLong;
    shortband[i] = pRm < pShort && rm < pShort ? Math.min(pShort, newShort) : newShort;

    // rsiMa breaking above the prior upper band flips up; below the lower band flips down.
    if (pRm <= pShort && rm > pShort) trend = 1;
    else if (pRm >= pLong && rm < pLong) trend = -1;

    signal[i] = trend === 1 ? longband[i]! : shortband[i]!;
    prev = i;
  }

  return { rsiMa, signal };
}
