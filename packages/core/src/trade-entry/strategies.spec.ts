import { computeEntryFeatures, type EntryCandle, type EntryFeatures } from './features';
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
