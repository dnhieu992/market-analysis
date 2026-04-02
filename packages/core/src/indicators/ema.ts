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

  return Number(ema.toFixed(6));
}
