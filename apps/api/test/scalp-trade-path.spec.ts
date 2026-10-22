import { buildTimeStopReport, emptyPath, extendPath, rWithTimeStop, type PathBar, type PathTrade } from '../src/modules/strategy-paper-trades/scalp-trade-path';

const M = 60_000;
const T0 = Date.UTC(2026, 9, 22, 15, 0);
/** 1m candle n after T0 (n = 0 is the fill candle). */
const bar = (n: number, low: number, high: number, close: number): PathBar => ({ t: T0 + n * M, closeT: T0 + n * M + M - 1, low, high, close });

// LONG LIMIT 100, SL 99 (1R = 1), filled in candle 0.
const trade = (over: Partial<PathTrade> = {}): PathTrade => ({
  entryPrice: 100,
  initialStopLoss: 99,
  direction: 'LONG',
  orderType: 'LIMIT',
  openedAt: new Date(T0),
  tp1HitAt: null,
  exitAt: null,
  ...over,
});

describe('scalp trade path', () => {
  it('logs R at each minute close, excursions, and ignores the fill candle range', () => {
    const t = trade();
    const p = extendPath(emptyPath(t)!, t, [bar(0, 95, 110, 100.5), bar(1, 99.5, 101.2, 101), bar(2, 100.2, 100.8, 100.4)]);
    expect(p.closeR).toEqual([0.5, 1, 0.4]);
    expect(p.mfeR).toBe(1.2);
    expect(p.mfeMin).toBe(2);
    expect(p.maeR).toBe(-0.5);
    expect(p.exitMin).toBeNull();
  });

  it('extends incrementally without duplicating minutes and stops at the exit candle', () => {
    const t = trade();
    let p = extendPath(emptyPath(t)!, t, [bar(0, 100, 100, 100), bar(1, 99.8, 100.3, 100.2)]);
    const exit = trade({ exitAt: new Date(T0 + 3 * M + M - 1) });
    p = extendPath(p, exit, [bar(1, 99.8, 100.3, 100.2), bar(2, 99.5, 100, 99.6), bar(3, 98.9, 99.7, 99)]);
    expect(p.closeR).toEqual([0, 0.2, -0.4]);
    expect(p.exitMin).toBe(4);
    expect(p.maeR).toBe(-1.1);
  });

  it('time stop: exits at the minute close only when neither TP1 nor the exit came first', () => {
    const t = trade({ exitAt: new Date(T0 + 59 * M + M - 1) });
    const bars = Array.from({ length: 60 }, (_, n) => bar(n, 99.9, 100.4, 100.3));
    const path = extendPath(emptyPath(t)!, t, bars);
    expect(path.exitMin).toBe(60);
    const study = { id: 'a', rMultiple: -1, feePct: 0.0005, path };
    const at30 = rWithTimeStop(study, 30);
    expect(at30.stopped).toBe(true);
    expect(at30.r).toBeCloseTo(0.3 - (100 + 100.3) * 0.0005, 6);
    expect(rWithTimeStop(study, null)).toEqual({ r: -1, stopped: false });
    expect(rWithTimeStop(study, 60)).toEqual({ r: -1, stopped: false });
    expect(rWithTimeStop({ ...study, path: { ...path, tp1Min: 10 } }, 30)).toEqual({ r: -1, stopped: false });
  });

  it('SHORT R sign and report totals', () => {
    const t = trade({ direction: 'SHORT', initialStopLoss: 101, exitAt: new Date(T0 + 40 * M + M - 1) });
    const bars = Array.from({ length: 41 }, (_, n) => bar(n, 99.4, 100, 99.5));
    const path = extendPath(emptyPath(t)!, t, bars);
    expect(path.closeR[0]).toBe(0.5);
    const report = buildTimeStopReport([{ id: 'x', rMultiple: -1, feePct: 0, path }]);
    const none = report.rows.find((r) => r.minutes === null)!;
    const m30 = report.rows.find((r) => r.minutes === 30)!;
    expect(none.totalR).toBe(-1);
    expect(m30.totalR).toBe(0.5);
    expect(m30.deltaR).toBe(1.5);
    expect(report.best).toBe(10);
    expect(report.ready).toBe(false);
  });
});
