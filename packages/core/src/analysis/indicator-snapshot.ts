import { calculateAtr } from '../indicators/atr';
import { calculateEma } from '../indicators/ema';
import { calculateMacd } from '../indicators/macd';
import { calculateRsi } from '../indicators/rsi';
import { extractSupportAndResistanceLevels } from '../indicators/support-resistance';
import { calculateVolumeRatio } from '../indicators/volume';
import type { IndicatorSnapshot } from '../types/analysis';
import type { Candle } from '../types/candle';

export function buildIndicatorSnapshot(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume ?? 0);
  const latest = candles[candles.length - 1] ?? { open: 0, high: 0, low: 0, close: 0 };
  const levels = extractSupportAndResistanceLevels(candles);

  return {
    price: {
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close
    },
    ema20: calculateEma(closes, 20),
    ema50: calculateEma(closes, 50),
    ema200: calculateEma(closes, 200),
    rsi14: calculateRsi(closes, 14),
    macd: calculateMacd(closes),
    atr14: calculateAtr(highs, lows, closes, 14),
    volumeRatio: calculateVolumeRatio(volumes),
    supportLevels: levels.supportLevels,
    resistanceLevels: levels.resistanceLevels,
    lastCandles: candles.slice(-5).map(({ open, high, low, close }) => ({ open, high, low, close }))
  };
}
