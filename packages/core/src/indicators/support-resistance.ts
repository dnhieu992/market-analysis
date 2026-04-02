import type { Candle } from '../types/candle';

type HighLowCandle = Pick<Candle, 'high' | 'low'>;

export function extractSupportAndResistanceLevels(candles: HighLowCandle[], maxLevels = 3) {
  const supportLevels = candles
    .filter((_, index) => index > 0 && index < candles.length - 1)
    .filter(
      (candle, index) =>
        candle.low <= candles[index]!.low && candle.low <= candles[index + 2]!.low
    )
    .map((candle) => candle.low)
    .slice(-maxLevels);

  const resistanceLevels = candles
    .filter((_, index) => index > 0 && index < candles.length - 1)
    .filter(
      (candle, index) =>
        candle.high >= candles[index]!.high && candle.high >= candles[index + 2]!.high
    )
    .map((candle) => candle.high)
    .slice(-maxLevels);

  return { supportLevels, resistanceLevels };
}
