import {
  computeSwingLimitOrder,
  computeDayTradeLimitOrder,
  evaluateLimitOrder,
} from './tracking-coin-orders';
import type { OrderSigSnapshot } from './tracking-coin-orders';

// Synthetic H4/H1 series with mild structure around price 100.
function series(n: number, base: number): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 3) * base * 0.02;
    highs.push(base + wave + base * 0.005);
    lows.push(base + wave - base * 0.005);
  }
  return { highs, lows };
}

const bullish: OrderSigSnapshot = {
  trend: 'Up', h4Trend: 'Up', m30Trend: 'Up',
  utBotD1Bullish: true, utBotH4Bullish: true,
  longScore: 7, shortScore: 2,
  ema200Above: true, rsi: 45, h4Rsi: 50, swingStructure: 'HH-HL',
};

const bearish: OrderSigSnapshot = {
  trend: 'Down', h4Trend: 'Down', m30Trend: 'Down',
  utBotD1Bullish: false, utBotH4Bullish: false,
  longScore: 2, shortScore: 7,
  ema200Above: false, rsi: 55, h4Rsi: 50, swingStructure: 'LH-LL',
};

const rangebound: OrderSigSnapshot = {
  trend: 'Neutral', h4Trend: 'Neutral', m30Trend: 'Neutral',
  utBotD1Bullish: null, utBotH4Bullish: null,
  longScore: 5, shortScore: 5,
  ema200Above: true, rsi: 50, h4Rsi: 50, swingStructure: 'Mixed',
};

describe('tracking-coin orders — P1 ATR stop + P2 regime/direction', () => {
  const price = 100;
  const { highs: h4H, lows: h4L } = series(60, price);
  const { highs: h1H, lows: h1L } = series(72, price);
  const atr = 2; // 2% of price

  it('P2 regime gate: range-bound D1 → no-trade (null) for both', () => {
    expect(computeSwingLimitOrder(price, h4H, h4L, rangebound, atr)).toBeNull();
    expect(computeDayTradeLimitOrder(price, h1H, h1L, rangebound, atr)).toBeNull();
  });

  it('P2 direction: swing follows D1 bias', () => {
    expect(computeSwingLimitOrder(price, h4H, h4L, bullish, atr)!.side).toBe('LONG');
    expect(computeSwingLimitOrder(price, h4H, h4L, bearish, atr)!.side).toBe('SHORT');
  });

  it('P2 direction sync: day-trade does NOT oppose D1 bias (no strong reversal)', () => {
    expect(computeDayTradeLimitOrder(price, h1H, h1L, bullish, atr)!.side).toBe('LONG');
    expect(computeDayTradeLimitOrder(price, h1H, h1L, bearish, atr)!.side).toBe('SHORT');
  });

  it('P2 reversal exception: D1 LONG + H4 bearish + RSI≥70 → counter-trend SHORT scalp', () => {
    const sig = { ...bullish, utBotH4Bullish: false, h4Rsi: 74 };
    expect(computeDayTradeLimitOrder(price, h1H, h1L, sig, atr)!.side).toBe('SHORT');
  });

  it('P1 ATR stop: LONG stop sits at least ~1×ATR below entry (not a tiny 0.5–0.8%)', () => {
    const o = computeSwingLimitOrder(price, h4H, h4L, bullish, atr)!;
    const entryMid = (o.entryLow + o.entryHigh) / 2;
    const stopDist = entryMid - o.sl;
    expect(o.sl).toBeLessThan(o.entryLow);
    expect(stopDist).toBeGreaterThan(atr); // wider than 1 ATR (~2% here), vs old ~0.8%
  });

  it('P1 stop scales with ATR: bigger ATR → wider stop', () => {
    const small = computeDayTradeLimitOrder(price, h1H, h1L, bullish, 1)!;
    const big   = computeDayTradeLimitOrder(price, h1H, h1L, bullish, 4)!;
    const dist = (o: typeof small) => (o.entryLow + o.entryHigh) / 2 - o.sl;
    expect(dist(big)).toBeGreaterThan(dist(small));
  });

  it('R:R is guaranteed ≥ minimum for both directions', () => {
    expect(computeSwingLimitOrder(price, h4H, h4L, bullish, atr)!.rrRatio).toBeGreaterThanOrEqual(1.5 - 1e-6);
    expect(computeSwingLimitOrder(price, h4H, h4L, bearish, atr)!.rrRatio).toBeGreaterThanOrEqual(1.5 - 1e-6);
  });

  // ── P4: evaluation no longer resolves on the activation candle ──────────────
  describe('evaluateLimitOrder (P4)', () => {
    // LONG entry zone 99–100, SL 97, TP1 105.
    const args = ['LONG', 99, 100, 105, null, 97] as const;

    it('does NOT count SL on the same candle that fills the entry', () => {
      // One bar dips through entry AND sl, then nothing else.
      const r = evaluateLimitOrder(...args, [100.5], [96.5]);
      expect(r.activated).toBe(true);
      expect(r.outcome).toBeNull(); // resolution deferred past the fill candle
    });

    it('resolves SL on a later candle after activation', () => {
      const r = evaluateLimitOrder(...args, [100.5, 98], [99.5, 96.5]);
      expect(r.activated).toBe(true);
      expect(r.outcome).toBe('sl');
    });

    it('resolves TP on a later candle after activation', () => {
      const r = evaluateLimitOrder(...args, [99.8, 106], [99.2, 101]);
      expect(r.activated).toBe(true);
      expect(r.outcome).toBe('tp1');
    });

    it('stays unactivated when price never reaches the entry zone', () => {
      const r = evaluateLimitOrder(...args, [110, 111], [108, 109]);
      expect(r.activated).toBe(false);
      expect(r.outcome).toBeNull();
    });
  });

  it('TP is on the correct side of entry', () => {
    const long = computeSwingLimitOrder(price, h4H, h4L, bullish, atr)!;
    const short = computeSwingLimitOrder(price, h4H, h4L, bearish, atr)!;
    expect(long.tp1).toBeGreaterThan((long.entryLow + long.entryHigh) / 2);
    expect(short.tp1).toBeLessThan((short.entryLow + short.entryHigh) / 2);
  });
});
