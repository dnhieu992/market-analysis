import { computeSmallCapSignal, computeTimeframeTrend } from './small-cap-signal';

/** Build OHLCV arrays from a close series (highs/lows hug closes, flat volume). */
function series(closes: number[], volume = 1000): {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
} {
  return {
    closes,
    highs: closes.map((c) => c * 1.001),
    lows: closes.map((c) => c * 0.999),
    volumes: closes.map(() => volume),
  };
}

describe('computeSmallCapSignal', () => {
  it('returns null when there are not enough candles', () => {
    const closes = Array.from({ length: 100 }, () => 100);
    const { highs, lows, volumes } = series(closes);
    expect(computeSmallCapSignal(closes, highs, lows, volumes)).toBeNull();
  });

  it('classifies a quiet grind-up as Trending with positive extPct', () => {
    // 150 flat candles, then a gentle sawtooth uptrend on quiet (constant) volume.
    const closes: number[] = [];
    for (let i = 0; i < 210; i++) {
      if (i < 150) closes.push(100);
      else {
        const t = i - 150;
        closes.push(100 + t * 0.18 + 1.5 * Math.sin(t / 2));
      }
    }
    const { highs, lows, volumes } = series(closes);

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    expect(result).not.toBeNull();
    // Confirmed uptrend: above EMA34 & EMA89, volume did NOT spike → not a Breakout.
    expect(result!.stage).toBe('Trending');
    expect(result!.volMultiplier).toBeLessThan(2);
    expect(result!.ema34Above).toBe(true);
    expect(result!.ema89Above).toBe(true);
    // extPct = distance above EMA34, positive in an uptrend.
    expect(result!.extPct).toBeGreaterThan(0);
  });

  it('reports a negative extPct when price is below EMA34', () => {
    // Flat base then a decline below the moving averages.
    const closes: number[] = [];
    for (let i = 0; i < 210; i++) {
      if (i < 150) closes.push(100);
      else closes.push(100 - (i - 150) * 0.2);
    }
    const { highs, lows, volumes } = series(closes);

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    expect(result).not.toBeNull();
    expect(result!.ema34Above).toBe(false);
    expect(result!.stage).not.toBe('Trending');
    expect(result!.extPct).toBeLessThan(0);
  });
});

describe('computeTimeframeTrend (daily-plan style 1-bar pivots)', () => {
  /** Repeat a zigzag pattern so there are several rising/falling swing pivots. */
  function zigzag(steps: number[], reps: number, start: number): number[] {
    const out: number[] = [];
    let v = start;
    for (let r = 0; r < reps; r++) {
      for (const s of steps) {
        v += s;
        out.push(v);
      }
    }
    return out;
  }

  it('reads a rising zigzag (HH + HL) as an uptrend', () => {
    const closes = zigzag([+4, -2], 15, 10); // net up, each swing higher
    const trend = computeTimeframeTrend(closes, closes, closes);
    expect(['Up', 'StrongUp']).toContain(trend);
  });

  it('reads a falling zigzag (LH + LL) as a downtrend', () => {
    const closes = zigzag([-4, +2], 15, 200); // net down, each swing lower
    const trend = computeTimeframeTrend(closes, closes, closes);
    expect(['Down', 'StrongDown']).toContain(trend);
  });

  it('returns Neutral when there is no clean HH/HL or LH/LL structure', () => {
    // Flat oscillation around a constant level — swings neither rising nor falling.
    const closes = zigzag([+3, -3], 15, 100);
    const trend = computeTimeframeTrend(closes, closes, closes);
    expect(trend).toBe('Neutral');
  });

  it('falls back to Neutral when there are too few candles', () => {
    expect(computeTimeframeTrend([1, 2, 3], [1, 2, 3], [1, 2, 3])).toBe('Neutral');
  });
});
