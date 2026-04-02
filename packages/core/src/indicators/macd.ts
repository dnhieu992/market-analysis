import { calculateEma } from './ema';

export function calculateMacd(values: number[]) {
  const ema12 = calculateEma(values, 12);
  const ema26 = calculateEma(values, 26);
  const macd = ema12 - ema26;
  const macdSeries = values.map((_, index) =>
    calculateEma(values.slice(0, index + 1), 12) - calculateEma(values.slice(0, index + 1), 26)
  );
  const signal = calculateEma(macdSeries, 9);
  const histogram = macd - signal;

  return {
    macd: Number(macd.toFixed(6)),
    signal: Number(signal.toFixed(6)),
    histogram: Number(histogram.toFixed(6))
  };
}
