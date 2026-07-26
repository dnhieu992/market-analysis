import { calculateSupertrend, calcSupertrendState } from './supertrend';
import type { Candle } from '../types/candle';

/** Candle series with a fixed 2-point range around `close`. */
const series = (closes: number[]): Candle[] =>
  closes.map((close) => ({ open: close, high: close + 2, low: close - 2, close }));

describe('supertrend(10, 3)', () => {
  it('returns nulls until the ATR is warm', () => {
    const { line, direction } = calculateSupertrend(series(Array.from({ length: 20 }, (_, i) => 100 + i)));

    expect(direction.slice(0, 9).every((d) => d === null)).toBe(true);
    expect(line.slice(0, 9).every((v) => v === null)).toBe(true);
    expect(direction[9]).not.toBeNull();
  });

  it('reports an uptrend with the line below price on a rising series', () => {
    const candles = series(Array.from({ length: 60 }, (_, i) => 100 + i));
    const state = calcSupertrendState(candles);

    expect(state?.direction).toBe('up');
    expect(state!.line).toBeLessThan(candles[candles.length - 1]!.close);
  });

  it('reports a downtrend with the line above price on a falling series', () => {
    const candles = series(Array.from({ length: 60 }, (_, i) => 200 - i));
    const state = calcSupertrendState(candles);

    expect(state?.direction).toBe('down');
    expect(state!.line).toBeGreaterThan(candles[candles.length - 1]!.close);
  });

  it('flips to down and counts bars since the flip when the trend reverses', () => {
    // 60 bars up, then a hard sell-off — the flip happens inside the drop.
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
    const falling = Array.from({ length: 10 }, (_, i) => 160 - (i + 1) * 12);
    const candles = series([...rising, ...falling]);

    const { direction } = calculateSupertrend(candles);
    const state = calcSupertrendState(candles);

    expect(direction[59]).toBe('up');
    expect(state?.direction).toBe('down');
    expect(state!.barsSince).not.toBeNull();
    expect(state!.barsSince).toBeGreaterThan(0);
    // barsSince must point at the actual flip bar.
    const flipIdx = candles.length - 1 - state!.barsSince!;
    expect(direction[flipIdx]).toBe('down');
    expect(direction[flipIdx - 1]).toBe('up');
  });

  it('marks the flip bar itself as a fresh flip', () => {
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
    const candles = series([...rising]);
    const { direction } = calculateSupertrend(candles);
    expect(direction[direction.length - 1]).toBe('up');

    // One candle far below the trailing line flips the trend on that very bar.
    const flipped = [...candles, ...series([80])];
    const state = calcSupertrendState(flipped);

    expect(state?.direction).toBe('down');
    expect(state?.barsSince).toBe(0);
    expect(state?.freshFlip).toBe(true);
  });

  it('never lets price sit on the wrong side of the active line', () => {
    // Zig-zag series so the trend flips repeatedly.
    const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 7) * 30 + i * 0.2);
    const candles = series(closes);
    const { line, direction } = calculateSupertrend(candles);

    for (let i = 0; i < candles.length; i++) {
      if (direction[i] === 'up') expect(candles[i]!.close).toBeGreaterThanOrEqual(line[i]!);
      if (direction[i] === 'down') expect(candles[i]!.close).toBeLessThanOrEqual(line[i]!);
    }
  });

  it('returns null when there are fewer candles than the ATR period', () => {
    expect(calcSupertrendState(series([1, 2, 3]))).toBeNull();
  });
});
