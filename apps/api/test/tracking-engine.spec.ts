import { buildTargets, closeManually, fill, step, validatePlan, type Bar, type EngineState } from '../src/modules/tracking-trades/tracking-engine';

const M = 60_000;
const T0 = Date.UTC(2026, 9, 24, 10, 0);
const bar = (n: number, low: number, high: number, close: number, open = close): Bar => ({ t: T0 + n * M, closeT: T0 + n * M + M - 1, open, low, high, close });

// LONG LIMIT 100, SL 95 (1R = $10 → qty 2), TP 110 / 120 / 130 at 50/30/20.
const state = (over: Partial<EngineState> = {}): EngineState => ({
  status: 'PENDING',
  direction: 'LONG',
  orderType: 'LIMIT',
  entryPrice: 100,
  stopLoss: 95,
  targets: buildTargets([110, 120, 130]),
  riskUsd: 10,
  fillPrice: null,
  quantity: null,
  remainingQty: null,
  currentStop: null,
  filledAt: null,
  closedAt: null,
  closeReason: null,
  realizedPnlUsd: 0,
  mfeR: null,
  maeR: null,
  mfeAt: null,
  maeAt: null,
  pathR: [],
  ...over,
});

const gross = (s: EngineState) => s.realizedPnlUsd; // fees make it slightly lower than the gross R

describe('tracking engine', () => {
  it('default split and plan validation', () => {
    expect(buildTargets([110, 120, 130]).map((t) => t.pct)).toEqual([50, 30, 20]);
    expect(buildTargets([110, 120]).map((t) => t.pct)).toEqual([50, 50]);
    expect(buildTargets([110, 120], [70, 30]).map((t) => t.pct)).toEqual([70, 30]);
    expect(validatePlan('LONG', 100, 95, buildTargets([110, 120]))).toBeNull();
    expect(validatePlan('LONG', 100, 105, buildTargets([110]))).toMatch(/SL/);
    expect(validatePlan('SHORT', 100, 105, buildTargets([90, 95]))).toMatch(/TP2/);
  });

  it('limit fills on a pullback, then TP1 → BE stop, TP2 → stop at TP1, TP3 closes', () => {
    const s = state();
    const ev = step(s, [bar(0, 101, 103, 102), bar(1, 99.5, 101, 100.5), bar(2, 100, 111, 110), bar(3, 105, 121, 119), bar(4, 118, 131, 130)]);
    expect(ev.map((e) => e.type)).toEqual(['FILLED', 'TP_HIT', 'STOP_MOVED', 'TP_HIT', 'STOP_MOVED', 'TP_HIT', 'CLOSED']);
    expect(s.status).toBe('CLOSED');
    expect(s.closeReason).toBe('TP');
    expect(s.quantity).toBeCloseTo(2);
    // 1×10 + 0.6×20 + 0.4×30 = 34 gross, minus fees
    expect(gross(s)).toBeLessThan(34);
    expect(gross(s)).toBeGreaterThan(33.5);
  });

  it('stop after TP1 closes the rest at break-even (BE)', () => {
    const s = state();
    step(s, [bar(0, 99, 101, 100), bar(1, 100, 110.5, 110), bar(2, 99.5, 108, 99.8)]);
    expect(s.status).toBe('CLOSED');
    expect(s.closeReason).toBe('BE');
    expect(gross(s)).toBeGreaterThan(9.5);
  });

  it('stop is checked before targets and on the fill candle only the stop counts', () => {
    const a = state();
    step(a, [bar(0, 94, 111, 100)]); // fills, touches SL and TP1 in the same candle
    expect(a.closeReason).toBe('SL');
    expect(a.realizedPnlUsd).toBeLessThan(-10);
    const b = state();
    step(b, [bar(0, 99, 101, 100), bar(1, 94, 111, 100)]);
    expect(b.closeReason).toBe('SL');
  });

  it('a STOP order fills at the open when it gaps through the entry', () => {
    const s = state({ orderType: 'STOP', entryPrice: 105, stopLoss: 100 });
    step(s, [bar(0, 101, 104, 103), bar(1, 106, 108, 107, 106.5)]);
    expect(s.fillPrice).toBe(106.5);
    expect(s.quantity).toBeCloseTo(10 / 6.5);
  });

  it('SHORT: excursions and hourly path in R', () => {
    const s = state({ direction: 'SHORT', entryPrice: 100, stopLoss: 105, targets: buildTargets([90]), orderType: 'MARKET' });
    fill(s, 100, T0 - M);
    const bars = Array.from({ length: 60 }, (_, n) => bar(n, 97, 102, 98));
    step(s, bars);
    expect(s.mfeR).toBe(0.6);
    expect(s.maeR).toBe(-0.4);
    expect(s.pathR).toEqual([0.4]);
  });

  it('manual partial close then full close', () => {
    const s = state();
    step(s, [bar(0, 99, 101, 100)]);
    closeManually(s, 50, 104, T0 + 5 * M);
    expect(s.remainingQty).toBeCloseTo(1);
    const ev = closeManually(s, 100, 106, T0 + 9 * M);
    expect(s.status).toBe('CLOSED');
    expect(s.closeReason).toBe('MANUAL');
    expect(ev[0]!.type).toBe('CLOSED');
    expect(s.realizedPnlUsd).toBeCloseTo(4 + 6 - (1 * 204 + 1 * 206) * 0.0005, 6);
  });
});
