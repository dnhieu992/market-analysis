import type { Candle } from './bitget.service';

export type UtBotEvaluation = {
  trend: 'bull' | 'bear';
  /** UTBot trailing-stop level on the last closed candle. */
  stop: number;
  /** Close of the last closed candle. */
  close: number;
  atr: number;
};

/** Wilder ATR series. Exact formula from scripts/run-flip-backtest.ts. */
function wilderAtr(c: Candle[], period: number): number[] {
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

function computeStops(c: Candle[], period: number, keyValue: number): number[] {
  const atr = wilderAtr(c, period);
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

/**
 * Evaluate the UTBot trend on candles ordered oldest→newest. The caller must pass
 * only CLOSED candles (drop the in-progress last one). Returns null if too few.
 *
 * trend = close > stop ? bull : bear — the same gate used in the backtest.
 */
export function evaluateUtBot(candles: Candle[], atrPeriod: number, keyValue: number): UtBotEvaluation | null {
  if (candles.length < atrPeriod + 2) return null;
  const stops = computeStops(candles, atrPeriod, keyValue);
  const atrs = wilderAtr(candles, atrPeriod);
  const last = candles.length - 1;
  const stop = stops[last]!;
  if (stop === 0) return null;
  const close = candles[last]!.close;
  return { trend: close > stop ? 'bull' : 'bear', stop, close, atr: atrs[last]! };
}
