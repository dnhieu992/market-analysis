import { calculateEma, calculateAtr } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const EMA_FAST      = 9;
const EMA_SLOW      = 21;
const EMA_TREND     = 200;
const EMA_H1_TREND  = 50;   // H1 EMA50: price above → bullish, below → bearish
const ATR_PERIOD    = 14;
const ADX_PERIOD    = 14;
const RSI_PERIOD    = 14;
const MIN_ADX       = 20;
const MIN_CANDLES   = EMA_TREND + ATR_PERIOD + 2;

// ── ADX ──────────────────────────────────────────────────────────────────────
function calculateAdx(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number {
  const len = closes.length;
  if (len < period * 2) return 0;

  const plusDM: number[]  = [];
  const minusDM: number[] = [];
  const tr: number[]      = [];

  for (let i = 1; i < len; i++) {
    const upMove   = highs[i]!  - highs[i - 1]!;
    const downMove = lows[i - 1]! - lows[i]!;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]!  - closes[i - 1]!)
    ));
  }

  let smoothTr    = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus  = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];

  for (let i = period; i < tr.length; i++) {
    smoothTr    = smoothTr    - smoothTr / period    + tr[i]!;
    smoothPlus  = smoothPlus  - smoothPlus / period  + plusDM[i]!;
    smoothMinus = smoothMinus - smoothMinus / period + minusDM[i]!;

    const diPlus  = (smoothPlus  / smoothTr) * 100;
    const diMinus = (smoothMinus / smoothTr) * 100;
    const diSum   = diPlus + diMinus;
    dxValues.push(diSum === 0 ? 0 : (Math.abs(diPlus - diMinus) / diSum) * 100);
  }

  if (dxValues.length < period) return 0;
  return dxValues.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── RSI ──────────────────────────────────────────────────────────────────────
function calculateRsi(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;

  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains  += diff;
    else           losses -= diff;
  }

  const avgGain = gains  / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ── Strategy ──────────────────────────────────────────────────────────────────
export class EmaCrossoverStrategy implements IBackTestStrategy {
  readonly name = 'ema-crossover';
  readonly description =
    'EMA9/21 cross + EMA200 trend + ADX>20 + RSI filter + H1 EMA50 trend align. M5. SL=1×ATR, TP=2×ATR.';
  readonly defaultTimeframe = '5m';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < MIN_CANDLES) return null;

    const closes = ctx.candles.map((c) => c.close);
    const highs  = ctx.candles.map((c) => c.high);
    const lows   = ctx.candles.map((c) => c.low);

    // ── EMA crossover ────────────────────────────────────────────────────────
    const ema9  = calculateEma(closes, EMA_FAST);
    const ema21 = calculateEma(closes, EMA_SLOW);

    const prevCloses = closes.slice(0, -1);
    const prevEma9   = calculateEma(prevCloses, EMA_FAST);
    const prevEma21  = calculateEma(prevCloses, EMA_SLOW);

    const isBullCross = prevEma9 <= prevEma21 && ema9 > ema21;
    const isBearCross = prevEma9 >= prevEma21 && ema9 < ema21;
    if (!isBullCross && !isBearCross) return null;

    // ── Filter 1: EMA200 trend ───────────────────────────────────────────────
    const ema200 = calculateEma(closes, EMA_TREND);
    const price  = ctx.current.close;
    if (isBullCross && price < ema200) return null;
    if (isBearCross && price > ema200) return null;

    // ── Filter 2: ADX > 20 ───────────────────────────────────────────────────
    const adx = calculateAdx(highs, lows, closes, ADX_PERIOD);
    if (adx < MIN_ADX) return null;

    // ── Filter 3: RSI ────────────────────────────────────────────────────────
    const rsi = calculateRsi(closes, RSI_PERIOD);
    if (isBullCross && rsi > 65) return null;
    if (isBearCross && rsi < 35) return null;

    // ── Filter 4: H1 trend (EMA50 on H1) ────────────────────────────────────
    const h1Candles = ctx.htfCandles['1h'] ?? [];
    if (h1Candles.length >= EMA_H1_TREND + 1) {
      const h1Closes = h1Candles.map((c) => c.close);
      const h1Ema50  = calculateEma(h1Closes, EMA_H1_TREND);
      const h1Price  = h1Candles[h1Candles.length - 1]!.close;
      if (isBullCross && h1Price < h1Ema50) return null; // H1 bearish → skip long
      if (isBearCross && h1Price > h1Ema50) return null; // H1 bullish → skip short
    }

    // ── Entry ────────────────────────────────────────────────────────────────
    const atr   = calculateAtr(highs, lows, closes, ATR_PERIOD);
    const entry = ctx.current.close;

    if (isBullCross) {
      return {
        direction:  'long',
        entryPrice: entry,
        stopLoss:   entry - atr,
        takeProfit: entry + atr * 2
      };
    }

    return {
      direction:  'short',
      entryPrice: entry,
      stopLoss:   entry + atr,
      takeProfit: entry - atr * 2
    };
  }
}

export default EmaCrossoverStrategy;