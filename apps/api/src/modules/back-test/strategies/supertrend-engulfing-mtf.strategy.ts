import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

// ── UTBot parameters ──────────────────────────────────────────────────────────
// ATR period 10, key value 1 — standard UTBot defaults for H4 BTC
const DEFAULT_ATR_PERIOD = 10;
const DEFAULT_KEY_VALUE = 1;

// ── Wilder ATR ────────────────────────────────────────────────────────────────

function computeWilderAtr(candles: Candle[], period: number): number[] {
  const n = candles.length;
  const trs: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });

  const atrs: number[] = new Array(n).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i]!;
  atrs[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    atrs[i] = (atrs[i - 1]! * (period - 1) + trs[i]!) / period;
  }
  return atrs;
}

// ── UTBot trailing stop ───────────────────────────────────────────────────────
// Replicates the Pine Script UTBot "xATRTrailingStop" logic.
// stop[i] ratchets toward price and only moves when price closes beyond it.

function computeUtBotStops(candles: Candle[], period: number, keyValue: number): number[] {
  const atrs = computeWilderAtr(candles, period);
  const stops: number[] = new Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const nLoss = keyValue * atrs[i]!;
    const c = candles[i]!.close;
    const prevC = candles[i - 1]!.close;
    const prevStop = stops[i - 1]!;

    if (c > prevStop && prevC > prevStop) {
      stops[i] = Math.max(prevStop, c - nLoss);
    } else if (c < prevStop && prevC < prevStop) {
      stops[i] = Math.min(prevStop, c + nLoss);
    } else if (c > prevStop) {
      stops[i] = c - nLoss;
    } else {
      stops[i] = c + nLoss;
    }
  }

  return stops;
}

// ── Signal detection ──────────────────────────────────────────────────────────
// Buy:  close[i] > stop[i] AND close[i-1] <= stop[i-1]  (bullish crossover)
// Sell: close[i] < stop[i] AND close[i-1] >= stop[i-1]  (bearish crossover)

function getLastSignal(candles: Candle[], stops: number[]): 'buy' | 'sell' | null {
  const last = candles.length - 1;
  if (last < 1) return null;

  const c = candles[last]!.close;
  const prevC = candles[last - 1]!.close;
  const stop = stops[last]!;
  const prevStop = stops[last - 1]!;

  if (c > stop && prevC <= prevStop) return 'buy';
  if (c < stop && prevC >= prevStop) return 'sell';
  return null;
}

// ── Strategy ──────────────────────────────────────────────────────────────────

export class SupertrendEngulfingMtfStrategy implements IBackTestStrategy {
  readonly name = 'supertrend-engulfing-mtf';
  readonly description =
    'UTBot ATR trailing stop on H4 BTCUSDT. ' +
    'Enter long/short on UTBot crossover signal. ' +
    'Exit via trailing ATR stop — no fixed TP. ' +
    'Params: atrPeriod (default 10), keyValue (default 1).';
  readonly defaultTimeframe = '4h';
  readonly forcedTimeframe = '4h';
  readonly disableBreakeven = true;

  private resolveParams(params: Record<string, unknown>): { atrPeriod: number; keyValue: number } {
    return {
      atrPeriod: typeof params['atrPeriod'] === 'number' ? params['atrPeriod'] : DEFAULT_ATR_PERIOD,
      keyValue: typeof params['keyValue'] === 'number' ? params['keyValue'] : DEFAULT_KEY_VALUE,
    };
  }

  evaluate(ctx: StrategyContext): TradeSignal | null {
    const { atrPeriod, keyValue } = this.resolveParams(ctx.params);
    if (ctx.candles.length < atrPeriod + 2) return null;

    const stops = computeUtBotStops(ctx.candles, atrPeriod, keyValue);
    const signal = getLastSignal(ctx.candles, stops);
    if (!signal) return null;

    const entry = ctx.current.close;
    const stopLevel = stops[ctx.candles.length - 1]!;

    if (signal === 'buy') {
      return {
        direction: 'long',
        entryPrice: entry,
        stopLoss: stopLevel,
        takeProfit: entry * 100, // Unreachable — exit is via trailing stop only
        trailingStop: true,
      };
    }

    // sell
    return {
      direction: 'short',
      entryPrice: entry,
      stopLoss: stopLevel,
      takeProfit: entry * 0.001, // Unreachable — exit is via trailing stop only
      trailingStop: true,
    };
  }

  getTrailingStopLoss(
    ctx: StrategyContext,
    trade: { direction: 'long' | 'short'; currentStopLoss: number }
  ): number {
    const { atrPeriod, keyValue } = this.resolveParams(ctx.params);
    if (ctx.candles.length < atrPeriod + 2) return trade.currentStopLoss;

    const stops = computeUtBotStops(ctx.candles, atrPeriod, keyValue);
    return stops[ctx.candles.length - 1]!;
  }
}

export default SupertrendEngulfingMtfStrategy;
