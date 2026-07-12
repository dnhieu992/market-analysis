import { computeAccumulationSignal, dcaGomPlan, type AccumulationParams } from './accumulation-signal';

// A long decline (90→50) into a tight, gently-falling base (49→45) — a coin sitting
// in an accumulation zone: deep drawdown from the weekly peak, low RSI, below EMA34.
function baseSeries(): { closesD1: number[]; highsD1: number[]; lowsD1: number[] } {
  const closes: number[] = [];
  for (let i = 0; i < 170; i++) closes.push(90 - (40 * i) / 169); // 90 → 50
  for (let i = 0; i < 29; i++) closes.push(49 - (4 * i) / 28); // 49 → 45
  closes.push(45); // current candle
  return {
    closesD1: closes,
    highsD1: closes.map((c) => c * 1.01),
    lowsD1: closes.map((c) => c * 0.99),
  };
}

function params(o: Partial<AccumulationParams> = {}): AccumulationParams {
  return {
    ...baseSeries(),
    weeklyHighs: [100], // peak = 100 → close 45 is −55% drawdown
    dcaScore: 60,
    ...o,
  };
}

describe('computeAccumulationSignal', () => {
  it('returns null without enough candles', () => {
    expect(computeAccumulationSignal({ closesD1: [1, 2, 3], highsD1: [1, 2, 3], lowsD1: [1, 2, 3], weeklyHighs: [3], dcaScore: 80 })).toBeNull();
  });

  it('measures drawdown from the weekly peak', () => {
    const sig = computeAccumulationSignal(params())!;
    expect(sig.drawdownPct).toBeCloseTo(55, 0);
  });

  it('flags GOM when in the accumulation base AND dcaScore clears the survival gate', () => {
    const sig = computeAccumulationSignal(params({ dcaScore: 60 }))!;
    expect(sig.inBase).toBe(true);
    expect(sig.gatePassed).toBe(true);
    expect(sig.zone).toBe('GOM');
  });

  it('downgrades to CHO when the same base fails the dcaScore gate (no SL defence)', () => {
    const sig = computeAccumulationSignal(params({ dcaScore: 40 }))!;
    expect(sig.inBase).toBe(true);
    expect(sig.gatePassed).toBe(false);
    expect(sig.zone).toBe('CHO');
  });

  it('exposes the consolidation base low for the gom price plan', () => {
    const sig = computeAccumulationSignal(params())!;
    // base = last 30 candles (49→45), lows are close×0.99 → base low ≈ 45×0.99.
    expect(sig.baseLow).toBeCloseTo(45 * 0.99, 2);
  });

  it('CHOT once price has reclaimed EMA34', () => {
    const closes: number[] = [];
    for (let i = 0; i < 200; i++) closes.push(40 + (20 * i) / 199); // steady climb → above EMA34
    const sig = computeAccumulationSignal({
      closesD1: closes,
      highsD1: closes.map((c) => c * 1.01),
      lowsD1: closes.map((c) => c * 0.99),
      weeklyHighs: [100],
      dcaScore: 80,
    })!;
    expect(sig.ema34Above).toBe(true);
    expect(sig.zone).toBe('CHOT');
  });
});

describe('dcaGomPlan', () => {
  it('returns null for a missing/invalid base low', () => {
    expect(dcaGomPlan(null)).toBeNull();
    expect(dcaGomPlan(0)).toBeNull();
    expect(dcaGomPlan(-5)).toBeNull();
  });

  it('builds an entry band and a 3-tier −15% ladder off the base low', () => {
    const plan = dcaGomPlan(100)!;
    expect(plan.zoneLow).toBe(100);
    expect(plan.zoneHigh).toBeCloseTo(108, 6); // base low + 8%
    // L1 = zoneHigh, each next tier −15%.
    expect(plan.ladder).toHaveLength(3);
    expect(plan.ladder[0]).toBeCloseTo(108, 6);
    expect(plan.ladder[1]).toBeCloseTo(108 * 0.85, 6);
    expect(plan.ladder[2]).toBeCloseTo(108 * 0.85 * 0.85, 6);
  });

  it('averages equal-USD tranches as the harmonic mean and targets x2', () => {
    const plan = dcaGomPlan(100)!;
    const harmonic = 3 / plan.ladder.reduce((s, p) => s + 1 / p, 0);
    expect(plan.avgCost).toBeCloseTo(harmonic, 6);
    expect(plan.targetX2).toBeCloseTo(plan.avgCost * 2, 6);
    // harmonic mean sits below the arithmetic mean of the ladder.
    const arithmetic = plan.ladder.reduce((s, p) => s + p, 0) / plan.ladder.length;
    expect(plan.avgCost).toBeLessThan(arithmetic);
  });
});
