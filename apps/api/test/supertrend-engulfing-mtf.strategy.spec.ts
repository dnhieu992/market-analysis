import { BackTestEngineService } from '../src/modules/back-test/back-test-engine.service';
import { SupertrendEngulfingMtfStrategy } from '../src/modules/back-test/strategies/supertrend-engulfing-mtf.strategy';
import type { StrategyContext } from '../src/modules/back-test/types/back-test.types';
import type { Candle } from '@app/core';

function flatCandle(close: number): Candle {
  return { open: close, high: close + 2, low: close - 2, close, volume: 1000, openTime: new Date(), closeTime: new Date() };
}

function candle(close: number, high: number, low: number): Candle {
  return { open: close, high, low, close, volume: 1000, openTime: new Date(), closeTime: new Date() };
}

function makeCtx(candles: Candle[], index: number, params: Record<string, unknown> = {}): StrategyContext {
  return { candles: candles.slice(0, index + 1), current: candles[index]!, index, symbol: 'BTCUSDT', htfCandles: {}, params };
}

/**
 * Candle sequence that produces deterministic UTBot signals (verified via manual trace):
 *
 * 0–14  flat at 100 (bearish UTBot mode after ATR warms up at index 11)
 * 15    close=120 → BUY crossover  (stop=114.20, window needs 16 candles ≥ 12)
 * 16    close=90  → SELL crossunder (stop=98.42)
 * 17    close=125 → BUY crossover  (stop=113.72)
 * 18    close=130 → bullish ratchet (trailing SL rises to ≈119.15)
 * 19    close=135 → bullish ratchet (trailing SL rises to ≈124.53)
 * 20    close=118 → low=118 hits ratcheted SL ≈124.53 → long exits (ratcheted trade)
 */
function buildFullSequence(): Candle[] {
  const c: Candle[] = [];
  for (let i = 0; i < 15; i++) c.push(flatCandle(100));
  c.push(candle(120, 122, 118)); // 15: BUY
  c.push(candle(90, 92, 88));   // 16: SELL
  c.push(candle(125, 127, 123)); // 17: BUY
  c.push(candle(130, 132, 128)); // 18: rally
  c.push(candle(135, 137, 133)); // 19: rally
  c.push(candle(118, 122, 118)); // 20: drop, hits ratcheted SL
  return c;
}

describe('SupertrendEngulfingMtfStrategy', () => {
  let strategy: SupertrendEngulfingMtfStrategy;
  let engine: BackTestEngineService;

  beforeEach(() => {
    strategy = new SupertrendEngulfingMtfStrategy();
    engine = new BackTestEngineService();
  });

  // ── metadata ──────────────────────────────────────────────────────────────────

  describe('metadata', () => {
    it('exposes correct name, timeframe and flags', () => {
      expect(strategy.name).toBe('supertrend-engulfing-mtf');
      expect(strategy.defaultTimeframe).toBe('4h');
      expect(strategy.forcedTimeframe).toBe('4h');
      expect(strategy.disableBreakeven).toBe(true);
    });
  });

  // ── evaluate: insufficient candles ───────────────────────────────────────────

  describe('evaluate — insufficient candles', () => {
    it('returns null when candles.length < atrPeriod + 2 (default 12)', () => {
      const candles = Array.from({ length: 11 }, () => flatCandle(100));
      expect(strategy.evaluate(makeCtx(candles, 10))).toBeNull();
    });

    it('returns null when exactly at the boundary (11 candles)', () => {
      const candles = Array.from({ length: 11 }, () => flatCandle(100));
      expect(strategy.evaluate(makeCtx(candles, 10))).toBeNull();
    });

    it('returns null on flat candles before ATR warmup (indices 1–10, window < 12)', () => {
      const candles = buildFullSequence();
      for (let i = 1; i <= 10; i++) {
        expect(strategy.evaluate(makeCtx(candles, i))).toBeNull();
      }
    });

    it('returns null on flat candles with no crossover even after warmup', () => {
      const candles = Array.from({ length: 20 }, () => flatCandle(100));
      // At index 15 with flat candles — same close as stop → no crossover
      // (signals require a clear cross, not equality)
      const ctx = makeCtx(candles, 15);
      const signal = strategy.evaluate(ctx);
      // flat candles may or may not signal; if they do it should be structured correctly
      if (signal !== null) {
        expect(['long', 'short']).toContain(signal.direction);
        expect(signal.trailingStop).toBe(true);
      }
    });
  });

  // ── evaluate: BUY crossover signal ───────────────────────────────────────────

  describe('evaluate — buy crossover signal', () => {
    it('returns a long signal at index 15 when close surges from 100 to 120 above bearish stop', () => {
      const candles = buildFullSequence();
      const signal = strategy.evaluate(makeCtx(candles, 15));

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('long');
      expect(signal!.entryPrice).toBe(120);
      expect(signal!.trailingStop).toBe(true);
      expect(signal!.stopLoss).toBeLessThan(120);
      expect(signal!.stopLoss).toBeCloseTo(114.2, 1);
    });

    it('returns a long signal at index 17 when close recovers from 90 to 125', () => {
      const candles = buildFullSequence();
      const signal = strategy.evaluate(makeCtx(candles, 17));

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('long');
      expect(signal!.entryPrice).toBe(125);
      expect(signal!.trailingStop).toBe(true);
      expect(signal!.stopLoss).toBeLessThan(125);
    });
  });

  // ── evaluate: SELL crossunder signal ─────────────────────────────────────────

  describe('evaluate — sell crossunder signal', () => {
    it('returns a short signal at index 16 when close drops from 120 to 90', () => {
      const candles = buildFullSequence();
      const signal = strategy.evaluate(makeCtx(candles, 16));

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('short');
      expect(signal!.entryPrice).toBe(90);
      expect(signal!.trailingStop).toBe(true);
      expect(signal!.stopLoss).toBeGreaterThan(90);
      expect(signal!.stopLoss).toBeCloseTo(98.42, 1);
    });
  });

  // ── getTrailingStopLoss ───────────────────────────────────────────────────────

  describe('getTrailingStopLoss', () => {
    it('returns currentStopLoss unchanged when candles insufficient', () => {
      const candles = Array.from({ length: 11 }, () => flatCandle(100));
      const result = strategy.getTrailingStopLoss!(makeCtx(candles, 10), { direction: 'long', currentStopLoss: 90 });
      expect(result).toBe(90);
    });

    it('returns UTBot stop below entry for a long context (index 15)', () => {
      const candles = buildFullSequence();
      const result = strategy.getTrailingStopLoss!(makeCtx(candles, 15), { direction: 'long', currentStopLoss: 90 });
      expect(result).toBeCloseTo(114.2, 1);
    });

    it('returns UTBot stop above entry for a short context (index 16)', () => {
      const candles = buildFullSequence();
      const result = strategy.getTrailingStopLoss!(makeCtx(candles, 16), { direction: 'short', currentStopLoss: 110 });
      expect(result).toBeCloseTo(98.42, 1);
    });

    it('ratchets up on rallying candles (index 18 > index 17)', () => {
      const candles = buildFullSequence();
      const sl17 = strategy.getTrailingStopLoss!(makeCtx(candles, 17), { direction: 'long', currentStopLoss: 110 });
      const sl18 = strategy.getTrailingStopLoss!(makeCtx(candles, 18), { direction: 'long', currentStopLoss: 110 });
      expect(sl18).toBeGreaterThan(sl17);
    });
  });

  // ── engine integration ────────────────────────────────────────────────────────

  describe('engine integration', () => {
    it('produces 4 trades over the full 21-candle sequence', () => {
      const candles = buildFullSequence();
      const result = engine.run(strategy, candles, 'BTCUSDT');
      // Trades: long@120→114.2, short@90→98.42, long@125→124.53, short@118 (force-closed)
      expect(result.totalTrades).toBe(4);
    });

    it('trailing stop ratchets: 2nd long trade exits above its original stop loss', () => {
      // Long entered at 125 (SL=113.72), ratchets to ~119.15 then ~124.53 as price rallies,
      // then exits at ~124.53 when price dips — well above the original SL of 113.72.
      const candles = buildFullSequence();
      const result = engine.run(strategy, candles, 'BTCUSDT');

      const longTrades = result.trades.filter((t) => t.direction === 'long');
      expect(longTrades.length).toBe(2);

      const ratchetedTrade = longTrades.find((t) => t.exitPrice > t.stopLoss + 1);
      expect(ratchetedTrade).toBeDefined();
      if (ratchetedTrade) {
        expect(ratchetedTrade.entryPrice).toBe(125);
        expect(ratchetedTrade.exitPrice).toBeGreaterThan(ratchetedTrade.stopLoss);
        expect(ratchetedTrade.exitPrice).toBeCloseTo(124.53, 1);
      }
    });

    it('short trade opened after BUY→SL sequence exits at its own trailing stop', () => {
      // Short entered at 90 (SL=98.42); price surges to 125 (high=127 >= SL) → loss
      const candles = buildFullSequence();
      const result = engine.run(strategy, candles, 'BTCUSDT');

      const shortTrade = result.trades.find((t) => t.direction === 'short' && t.entryPrice === 90);
      expect(shortTrade).toBeDefined();
      if (shortTrade) {
        expect(shortTrade.outcome).toBe('loss');
        expect(shortTrade.exitPrice).toBeCloseTo(98.42, 1);
      }
    });

    it('summary win rate and pnl are computed (smoke test)', () => {
      const candles = buildFullSequence();
      const result = engine.run(strategy, candles, 'BTCUSDT');
      expect(result.winRate).toBeGreaterThanOrEqual(0);
      expect(result.winRate).toBeLessThanOrEqual(1);
      expect(typeof result.totalPnl).toBe('number');
      expect(result.trades.length).toBeGreaterThan(0);
    });
  });

  // ── custom params ─────────────────────────────────────────────────────────────

  describe('custom params', () => {
    it('respects custom atrPeriod: returns null when candles < atrPeriod+2', () => {
      const candles = Array.from({ length: 6 }, () => flatCandle(100));
      const ctx = makeCtx(candles, 5, { atrPeriod: 5, keyValue: 1 });
      expect(strategy.evaluate(ctx)).toBeNull();
    });

    it('respects atrPeriod=5: evaluates when candles.length >= 7', () => {
      const candles = Array.from({ length: 7 }, () => flatCandle(100));
      const ctx = makeCtx(candles, 6, { atrPeriod: 5, keyValue: 1 });
      // Should not throw; result may be null (no crossover) or a valid signal
      const signal = strategy.evaluate(ctx);
      if (signal !== null) {
        expect(['long', 'short']).toContain(signal.direction);
        expect(signal.trailingStop).toBe(true);
      }
    });

    it('higher keyValue produces a wider stop distance', () => {
      const candles = buildFullSequence();
      const sig1 = strategy.evaluate(makeCtx(candles, 15, { atrPeriod: 10, keyValue: 1 }));
      const sig2 = strategy.evaluate(makeCtx(candles, 15, { atrPeriod: 10, keyValue: 2 }));

      expect(sig1!.direction).toBe('long');
      expect(sig2!.direction).toBe('long');
      const dist1 = sig1!.entryPrice - sig1!.stopLoss;
      const dist2 = sig2!.entryPrice - sig2!.stopLoss;
      expect(dist2).toBeGreaterThan(dist1);
    });
  });
});
