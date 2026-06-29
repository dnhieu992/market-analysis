import { computeAccumulationSignal, type AccumulationParams } from './accumulation-signal';

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
