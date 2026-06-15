import { Injectable } from '@nestjs/common';
import type { Candle } from './bitget.service';

export type Trend = 'bull' | 'bear';

export type UtBotEvaluation = {
  trend: Trend;
  /** UTBot trailing stop level on the last closed candle (the flip trigger). */
  stop: number;
  /** Close of the last closed candle (entry/exit price for the flip). */
  close: number;
  /** Wilder ATR on the last closed candle. */
  atr: number;
};

/**
 * UTBot trend stop-and-reverse strategy (the user's preferred swing flow).
 *
 * UTBot = Wilder-ATR trailing stop with nLoss = keyValue × ATR(atrPeriod).
 * trend = close > stop ? bull : bear. A confirmed flip on a CLOSED candle is the
 * entry/exit trigger. This is the exact, backtest-verified formula from
 * scripts/run-flip-backtest.ts.
 */
@Injectable()
export class UtBotStrategyService {
  /** Evaluate the strategy on candles ordered oldest→newest. Returns null if too few. */
  evaluate(candles: Candle[], atrPeriod: number, keyValue: number): UtBotEvaluation | null {
    if (candles.length < atrPeriod + 2) return null;

    const stops = this.computeStops(candles, atrPeriod, keyValue);
    const atrs = this.wilderAtr(candles, atrPeriod);
    const last = candles.length - 1;
    const close = candles[last]!.close;
    const stop = stops[last]!;
    if (stop === 0) return null;

    return {
      trend: close > stop ? 'bull' : 'bear',
      stop,
      close,
      atr: atrs[last]!,
    };
  }

  private wilderAtr(c: Candle[], period: number): number[] {
    const n = c.length;
    const tr = c.map((x, i) =>
      i === 0
        ? x.high - x.low
        : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close)),
    );
    const atr = new Array<number>(n).fill(0);
    if (n < period) return atr;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i]!;
    atr[period - 1] = sum / period;
    for (let i = period; i < n; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
    return atr;
  }

  private computeStops(c: Candle[], period: number, keyValue: number): number[] {
    const atr = this.wilderAtr(c, period);
    const stop = new Array<number>(c.length).fill(0);
    for (let i = 1; i < c.length; i++) {
      const nLoss = keyValue * atr[i]!;
      const close = c[i]!.close;
      const prevC = c[i - 1]!.close;
      const prev = stop[i - 1]!;
      if (close > prev && prevC > prev) stop[i] = Math.max(prev, close - nLoss);
      else if (close < prev && prevC < prev) stop[i] = Math.min(prev, close + nLoss);
      else if (close > prev) stop[i] = close - nLoss;
      else stop[i] = close + nLoss;
    }
    return stop;
  }
}
