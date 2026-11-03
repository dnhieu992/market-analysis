import { evaluateJunkSetup, formatJunkShortAlert, junkEligibilityAt, junkLadderPlan, type JunkBar } from './junk-short-scan';

const bar = (i: number, o: number, h: number, l: number, c: number, qv = 1): JunkBar => ({ t: i * 86_400_000, o, h, l, c, qv });
const flat = (n: number, p = 1): JunkBar[] => Array.from({ length: n }, (_, i) => bar(i, p, p, p, p));

describe('evaluateJunkSetup', () => {
  it('needs at least 61 closed bars', () => {
    expect(evaluateJunkSetup(flat(60))).toBeNull();
  });

  it('flags setup A on a ≥ +50% 3-day close-to-close pump', () => {
    const bars = [...flat(70), bar(70, 1, 1.2, 1, 1.2), bar(71, 1.2, 1.4, 1.2, 1.4), bar(72, 1.4, 1.6, 1.4, 1.55, 10)];
    const ev = evaluateJunkSetup(bars)!;
    expect(ev.setup).toBe('A_PUMP_FADE');
    expect(ev.pump3d).toBeCloseTo(0.55);
    expect(ev.volumeX20d).toBeCloseTo(10);
  });

  it('marks a +30–50% pump as WATCH_PUMP only', () => {
    const bars = [...flat(70), bar(70, 1, 1.1, 1, 1.1), bar(71, 1.1, 1.2, 1.1, 1.2), bar(72, 1.2, 1.4, 1.2, 1.35)];
    expect(evaluateJunkSetup(bars)!.setup).toBe('WATCH_PUMP');
  });

  it('flags setup B: downtrend, red candle wicks into EMA20, closes under EMA50', () => {
    // steady decline 2.0 → ~1.0, then a red bounce candle touching EMA20
    const bars: JunkBar[] = Array.from({ length: 80 }, (_, i) => {
      const p = 2 - i * 0.0125;
      return bar(i, p, p, p, p);
    });
    const last = bars[bars.length - 1]!;
    bars.push(bar(80, last.c * 1.01, last.c * 1.2, last.c * 0.98, last.c * 0.99));
    expect(evaluateJunkSetup(bars)!.setup).toBe('B_EMA_BOUNCE');
  });

  it('no setup on a flat chart', () => {
    expect(evaluateJunkSetup(flat(80))!.setup).toBeNull();
  });
});

describe('junkLadderPlan', () => {
  it('setup A: 0/+30/+60%, stop +100%', () => {
    expect(junkLadderPlan('A_PUMP_FADE', 1)).toEqual({ entries: [1, 1.3, 1.6], hardStop: 2, takeProfit: 'avg entry -20%', timeStopDays: 30 });
  });
  it('setup B: 0/+15/+30%, stop +50%', () => {
    expect(junkLadderPlan('B_EMA_BOUNCE', 1)).toEqual({ entries: [1, 1.15, 1.3], hardStop: 1.5, takeProfit: 'avg entry -10%', timeStopDays: 20 });
  });
});

describe('formatJunkShortAlert', () => {
  it('lists setup A coins and junk movers', () => {
    const msg = formatJunkShortAlert({
      btcBear: true,
      setupA: [
        {
          symbol: 'FOOUSDT', setup: 'A_PUMP_FADE', marketCapUsdM: 120, capBeforePumpUsdM: 60, belowAthPct: 90, athPrice: 5, monitoringTag: true, listingDays: 400, pump3dPct: 80,
          signalDate: '2026-11-02', signalDayChangePct: 30, volumeX20d: 8, price: 0.5, todayFromOpenPct: -2, pumpTop: 0.6,
          ema20: 0.35, ema50: 0.3, fundingPct: -0.2, change24hPct: 20, plan: junkLadderPlan('A_PUMP_FADE', 0.5),
        },
      ],
      movers: [
        { rank: 1, symbol: 'BARUSDT', change24hPct: 41.2, quoteVolume24hUsdM: 30, price: 0.1, fundingPct: 0.01, spotListed: true,
          marketCapUsdM: 90, capBeforePumpUsdM: 60, belowAthPct: 80, listingDays: 300, monitoringTag: false, junk: true, notJunkReason: null, pump3dIfClosedNowPct: 55, setup: null },
      ],
    });
    expect(msg).toContain('FOOUSDT');
    expect(msg).toContain('⚠️Monitoring');
    expect(msg).toContain('⚠️funding -0.2%');
    expect(msg).toContain('BARUSDT');
    expect(msg).toContain('+55%');
  });
});

describe('junkEligibilityAt', () => {
  const rule = { minCap: 20e6, maxCap: 500e6, minBelowAth: 0.5 };
  // ATH 10 on an old weekly bar; daily history around 1–3.
  const weekly: JunkBar[] = [bar(-100, 5, 10, 5, 8)];
  const daily = [...flat(70, 1), bar(70, 1, 3, 1, 3)];

  it('uses the cap and ATH of the reference day, not today', () => {
    // ref = day 69 (before the pump): cap = 50M supply × 1 = $50M, 90% below ATH 10
    const e = junkEligibilityAt(daily, weekly, 69, 50e6, rule);
    expect(e).toMatchObject({ junk: true, capUsd: 50e6, athPrice: 10, reason: null });
    expect(e.belowAth).toBeCloseTo(0.9);
  });

  it('rejects caps outside $20–500M before the pump', () => {
    expect(junkEligibilityAt(daily, weekly, 69, 10e6, rule).reason).toBe('cap before pump < $20M');
    expect(junkEligibilityAt(daily, weekly, 69, 600e6, rule).reason).toBe('cap before pump > $500M');
  });

  it('rejects coins within 50% of their ATH', () => {
    const e = junkEligibilityAt(daily, [bar(-100, 1, 1.5, 1, 1.2)], 69, 50e6, rule);
    expect(e.junk).toBe(false);
    expect(e.reason).toBe('only 33% below ATH (< 50%)');
  });

  it('ignores weekly bars that are not closed before the reference day', () => {
    const e = junkEligibilityAt(daily, [bar(66, 1, 50, 1, 1)], 69, 50e6, rule);
    expect(e.athPrice).toBe(1);
  });
});
