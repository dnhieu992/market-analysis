import { computeEntryFeatures, d1StructureOf, detectSweepReclaimH4, type EntryCandle, type EntryFeatures } from './features';
import { formatEntryReasonNote } from './note';
import { evaluateEntryStrategies, findEntryStrategy, matchEntryStrategies } from './strategies';

function features(over: Partial<EntryFeatures>): EntryFeatures {
  return {
    featureSetVersion: 1,
    at: '2026-11-01T00:00:00.000Z',
    price: 100,
    qqeD1: 'long',
    qqeD1BarsSinceCross: 5,
    qqeH4: 'short',
    qqe1h: 'short',
    rsiD1: 50,
    rsiH4: 38,
    rsi1h: 40,
    ema34D1: 95,
    ema89D1: 90,
    distEma34D1Pct: 5,
    distEma89D1Pct: 11,
    ema34D1Slope5Pct: 1,
    ema89H4: 98,
    distEma89H4Pct: 2,
    chg24hPct: -2,
    chg7dPct: 3,
    chg30dPct: 8,
    range20dPos: 0.4,
    btc: null,
    ...over,
  };
}

const long = { symbol: 'SOLUSDT', side: 'long' as const };

describe('entry strategies', () => {
  it('grades the swing pullback A, then B, then none', () => {
    const grade = (f: EntryFeatures) => matchEntryStrategies(f, long).find((m) => m.key === 'qqe-pullback-swing')?.grade;
    expect(grade(features({}))).toBe('A');
    expect(grade(features({ rsiH4: 43, distEma89D1Pct: 20 }))).toBe('B');
    expect(grade(features({ rsiH4: 47 }))).toBeUndefined();
    expect(grade(features({ qqeD1: 'short' }))).toBeUndefined();
  });

  it('flags a strong scalp only with QQE H4 long and RSI 1h < 30', () => {
    const grade = (f: EntryFeatures) => matchEntryStrategies(f, long).find((m) => m.key === 'qqe-rsi1h-scalp')?.grade;
    expect(grade(features({ rsi1h: 33 }))).toBe('normal');
    expect(grade(features({ rsi1h: 28, qqeH4: 'long' }))).toBe('strong');
    expect(grade(features({ rsi1h: 36 }))).toBeUndefined();
  });

  it('allows a hedge short on an alt only against an open long of at most twice its size', () => {
    const f = features({});
    const hedge = (symbol: string, opposite: { size: number } | null, size: number) =>
      matchEntryStrategies(f, { symbol, side: 'short', opposite, size }).some((m) => m.key === 'hedge-short');
    expect(hedge('SOLUSDT', { size: 10 }, 5)).toBe(true);
    expect(hedge('SOLUSDT', { size: 10 }, 6)).toBe(false);
    expect(hedge('SOLUSDT', null, 5)).toBe(false);
    expect(hedge('BTCUSDT', { size: 10 }, 5)).toBe(false);
  });

  it('never matches long-only strategies on a short', () => {
    const r = evaluateEntryStrategies(features({}), { symbol: 'ETHUSDT', side: 'short' });
    expect(r.filter((s) => s.grade).map((s) => s.key)).toEqual([]);
  });

  it('resolves the latest version and keeps discretionary declare-only', () => {
    expect(findEntryStrategy('qqe-pullback-swing')?.version).toBe(1);
    expect(findEntryStrategy('discretionary')?.matchable).toBe(false);
    expect(findEntryStrategy('nope')).toBeNull();
  });

  it('computes features from candles and writes a readable journal note', () => {
    const candles = (n: number, step: number): EntryCandle[] =>
      Array.from({ length: n }, (_, i) => {
        const close = 100 + Math.sin(i / 5) * 5 + i * 0.05;
        return { closeTime: i * step, high: close * 1.01, low: close * 0.99, close };
      });
    const f = computeEntryFeatures({ at: new Date(0), price: 105, d1: candles(200, 86_400_000), h4: candles(200, 14_400_000), h1: candles(100, 3_600_000) });
    expect(f.ema89D1).not.toBeNull();
    expect(f.rsiH4).not.toBeNull();
    expect(['long', 'short', null]).toContain(f.qqeD1);
    const note = formatEntryReasonNote({ event: 'OPEN', source: 'AI_CARD', strategyKey: 'qqe-pullback-swing', grade: 'A', reason: 'test', features: f, matched: [] });
    expect(note).toContain('🧭 **Lý do vào lệnh**');
    expect(note).toContain('hạng A');
    expect(note).toContain('Lý do: test');
  });
});

describe('pa-sweep-reclaim', () => {
  const c = (low: number, high: number, close: number, i: number): EntryCandle => ({ closeTime: i, low, high, close });

  /** Zig-zag uptrend on D1: higher highs and higher lows. */
  function d1Up(): EntryCandle[] {
    const out: EntryCandle[] = [];
    let base = 100;
    for (let i = 0; i < 60; i++) {
      const phase = i % 10;
      const lvl = base + (phase < 5 ? phase : 10 - phase) * 2;
      out.push(c(lvl - 1, lvl + 1, lvl, i));
      if (phase === 9) base += 3;
    }
    return out;
  }

  /** Flat H4 with one clear swing low at index 50, then a sweep on the last candle. */
  function h4Sweep(sweepLast: boolean): EntryCandle[] {
    const out: EntryCandle[] = [];
    for (let i = 0; i < 60; i++) {
      let low = 99;
      if (i === 50) low = 95;
      if (i === 49 || i === 51) low = 97;
      out.push(c(low, 102, 100, i));
    }
    if (sweepLast) out[59] = c(94, 101, 96, 59);
    return out;
  }

  it('finds D1 HH+HL and the first sweep & reclaim of the latest H4 swing low', () => {
    expect(d1StructureOf(d1Up())).toBe('up');
    expect(detectSweepReclaimH4(h4Sweep(true))).toEqual({ barsAgo: 0, sweptLow: 95, low: 94, close: 96 });
    expect(detectSweepReclaimH4(h4Sweep(false))).toBeNull();
    // A close below the swept low is not a reclaim.
    const h = h4Sweep(true);
    h[59] = c(94, 101, 94.5, 59);
    expect(detectSweepReclaimH4(h)).toBeNull();
  });

  it('matches only with v2 features, D1 up, a sweep and price above the swept low', () => {
    const grade = (f: EntryFeatures, side: 'long' | 'short' = 'long') =>
      matchEntryStrategies(f, { symbol: 'SOLUSDT', side }).find((m) => m.key === 'pa-sweep-reclaim')?.grade;
    const sweep = { barsAgo: 0, sweptLow: 95, low: 94, close: 96 };
    expect(grade(features({ price: 96, d1Structure: 'up', paSweepH4: sweep }))).toBe('A');
    expect(grade(features({ price: 96, d1Structure: 'mixed', paSweepH4: sweep }))).toBeUndefined();
    expect(grade(features({ price: 96, d1Structure: 'up', paSweepH4: null }))).toBeUndefined();
    expect(grade(features({ price: 94.8, d1Structure: 'up', paSweepH4: sweep }))).toBeUndefined();
    expect(grade(features({ price: 96, d1Structure: 'up', paSweepH4: sweep }), 'short')).toBeUndefined();
    expect(grade(features({}))).toBeUndefined(); // v1 snapshot without the PA fields
  });

  it('computeEntryFeatures fills the PA fields', () => {
    const f = computeEntryFeatures({ at: new Date(0), price: 96, d1: d1Up(), h4: h4Sweep(true), h1: [] });
    expect(f.featureSetVersion).toBe(2);
    expect(f.d1Structure).toBe('up');
    expect(f.paSweepH4?.sweptLow).toBe(95);
  });
});
