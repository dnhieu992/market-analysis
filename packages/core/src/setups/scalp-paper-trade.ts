/**
 * Shared helpers for the M15 scalp paper-trading monitor (BTCUSDT). Claude decides
 * every entry, hold/adjust, and early-close call each tick (see
 * scripts/run-scalp-paper-monitor.ts) — this file only holds the parts that are
 * deliberately NOT left to the model's judgment:
 *
 *   - Position sizing: a stop-out always costs exactly `SCALP_RISK_USD`, no matter
 *     what stop distance Claude picks.
 *   - Stop-loss execution: once a stop (or target) is set, whether it was touched
 *     between ticks is decided by replaying real candles, not by asking the model.
 *     Claude can tighten a stop or close early, but the mechanical stop is the hard
 *     floor on how much a trade can lose — it is never "forgotten".
 *
 * `detectTrend` is offered to the model as a computed hint alongside the raw
 * candles, not as a gate — Claude reads price action itself.
 */
import type { Candle } from '../types/candle';

export const SCALP_RISK_USD = 1;
/** The trader's real fee, one side. A round trip therefore costs twice this. */
export const SCALP_FEE_PCT_PER_SIDE = 0.05;

export type ScalpDirection = 'LONG' | 'SHORT';
export type ScalpTrend = 'uptrend' | 'downtrend' | 'sideway';

/**
 * What Claude is asked to decide each tick. The monitor is limit-order based: when
 * flat Claude pre-computes a resting limit (`PLACE_LIMIT_*`); a candle touching that
 * limit fills it into an open trade mechanically (no model call). While a limit is
 * resting Claude can `KEEP`, `UPDATE_LIMIT`, or `CANCEL` it; once open it manages
 * with `HOLD` / `ADJUST` / `CLOSE_NOW`.
 */
export type ScalpAction =
  | 'PLACE_LIMIT_LONG'
  | 'PLACE_LIMIT_SHORT'
  | 'NO_TRADE'
  | 'KEEP'
  | 'UPDATE_LIMIT'
  | 'CANCEL'
  | 'HOLD'
  | 'ADJUST'
  | 'CLOSE_NOW';

export type ScalpDecision = {
  action: ScalpAction;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  reasoning: string;
};

// ── Swing structure (informational hint only, not a gate) ─────────────────────

function findSwingIndices(candles: Candle[], type: 'high' | 'low', lookback = 2): number[] {
  const result: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]!;
    let isSwing = true;
    for (let k = 1; k <= lookback; k++) {
      const a = candles[i - k]!;
      const b = candles[i + k]!;
      if (type === 'high' ? !(c.high > a.high && c.high > b.high) : !(c.low < a.low && c.low < b.low)) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) result.push(i);
  }
  return result;
}

function countConsecutivePairs(values: number[], ascending: boolean): number {
  let count = 0;
  for (let i = values.length - 1; i >= 1; i--) {
    const ok = ascending ? values[i]! > values[i - 1]! : values[i]! < values[i - 1]!;
    if (ok) count++;
    else break;
  }
  return count;
}

/** Swing-structure trend read (>= 2 consecutive HH+HL, or LH+LL) — a hint for the prompt. */
export function detectTrend(candles: Candle[]): ScalpTrend {
  const highs = findSwingIndices(candles, 'high').slice(-5).map((i) => candles[i]!.high);
  const lows = findSwingIndices(candles, 'low').slice(-5).map((i) => candles[i]!.low);
  if (highs.length < 3 || lows.length < 3) return 'sideway';

  const hhPairs = countConsecutivePairs(highs, true);
  const hlPairs = countConsecutivePairs(lows, true);
  const lhPairs = countConsecutivePairs(highs, false);
  const llPairs = countConsecutivePairs(lows, false);

  if (hhPairs >= 2 && hlPairs >= 2) return 'uptrend';
  if (lhPairs >= 2 && llPairs >= 2) return 'downtrend';
  return 'sideway';
}

// ── Sizing + PnL (never left to the model) ─────────────────────────────────────

/** Position size (base asset units) so a stop-out costs exactly `riskUsd`. */
export function computeScalpQuantity(entryPrice: number, stopLoss: number, riskUsd = SCALP_RISK_USD): number {
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit <= 0) return 0;
  return riskUsd / riskPerUnit;
}

/** Realized USD PnL, net of round-trip fees at `SCALP_FEE_PCT_PER_SIDE` per side. */
export function computeScalpPnlUsd(
  direction: ScalpDirection,
  entryPrice: number,
  exitPrice: number,
  quantity: number
): number {
  const raw = direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
  const gross = raw * quantity;
  const feeUsd = (entryPrice + exitPrice) * quantity * (SCALP_FEE_PCT_PER_SIDE / 100);
  return gross - feeUsd;
}

/** Exit expressed in units of the *original* risk (the stop distance at entry). */
export function computeScalpRMultiple(
  direction: ScalpDirection,
  entryPrice: number,
  initialStopLoss: number,
  exitPrice: number
): number | null {
  const risk = direction === 'LONG' ? entryPrice - initialStopLoss : initialStopLoss - entryPrice;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const move = direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return move / risk;
}

/**
 * Claude may tighten a stop (reduce risk / protect profit) but never loosen it — this
 * is what keeps `SCALP_RISK_USD` a real ceiling instead of just a suggestion. Returns
 * the tighter of the current and proposed stop.
 */
export function clampStopTighten(direction: ScalpDirection, currentStop: number, proposedStop: number): number {
  return direction === 'LONG' ? Math.max(currentStop, proposedStop) : Math.min(currentStop, proposedStop);
}

// ── Mechanical fill detection (never left to the model) ────────────────────────

export type ScalpFill = {
  status: 'CLOSED_SL' | 'CLOSED_TP';
  exitPrice: number;
  at: Date;
};

export type ScalpLimitFill = {
  /** Always the limit price — a resting limit fills at its own price, not the wick. */
  fillPrice: number;
  at: Date;
};

/**
 * Replays candles against a resting LIMIT order and returns the first candle that
 * touches it, if any. A buy-limit (LONG) fills when a candle's low reaches down to
 * the limit; a sell-limit (SHORT) fills when a candle's high reaches up to it. The
 * fill price is always the limit itself (a resting order executes at its price).
 */
export function checkLimitFill(
  direction: ScalpDirection,
  limitPrice: number,
  candles: Candle[]
): ScalpLimitFill | null {
  const isLong = direction === 'LONG';
  for (const candle of candles) {
    const touched = isLong ? candle.low <= limitPrice : candle.high >= limitPrice;
    if (touched) {
      return { fillPrice: limitPrice, at: candle.closeTime ?? candle.openTime ?? new Date() };
    }
  }
  return null;
}

/**
 * Replays candles against the CURRENT stop/target (whatever Claude last set them to)
 * and returns the first fill, if any. A candle that trades through both is scored as
 * the stop — the pessimistic read, since intra-candle order is unknowable from OHLC.
 */
export function checkStopTakeProfitHit(
  direction: ScalpDirection,
  stopLoss: number,
  takeProfit: number,
  candles: Candle[]
): ScalpFill | null {
  const isLong = direction === 'LONG';

  for (const candle of candles) {
    const at = candle.closeTime ?? candle.openTime ?? new Date();

    const slHit = isLong ? candle.low <= stopLoss : candle.high >= stopLoss;
    if (slHit) return { status: 'CLOSED_SL', exitPrice: stopLoss, at };

    const tpHit = isLong ? candle.high >= takeProfit : candle.low <= takeProfit;
    if (tpHit) return { status: 'CLOSED_TP', exitPrice: takeProfit, at };
  }

  return null;
}
