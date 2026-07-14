export function calculateEma(values: number[], period: number): number {
  if (values.length === 0) {
    return 0;
  }

  if (values.length <= period) {
    return values[values.length - 1] ?? 0;
  }

  const smoothing = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  for (const value of values.slice(period)) {
    ema = value * smoothing + ema * (1 - smoothing);
  }

  // Return full precision. Do NOT round to a fixed number of decimals here — for micro-priced
  // coins (PEPE ~2.7e-6, SHIB, BONK) rounding to 6 decimals collapses the EMA to ~1 significant
  // figure and fabricates a large distance-from-EMA error. Callers round for display if needed.
  return ema;
}
