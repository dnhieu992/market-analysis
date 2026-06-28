import { SetupExtractionService } from '../src/modules/setup-tracking/setup-extraction.service';

type GateRow = {
  slot: string;
  direction: 'long' | 'short' | 'none';
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number | null;
  takeProfit2: number | null;
};

// Reach the private rejectReason() for direct, fast unit coverage of the gates.
function reject(row: GateRow, trend: 'bullish' | 'bearish' | 'neutral', price: number): string | null {
  const svc = new SetupExtractionService();
  return (svc as unknown as {
    rejectReason: (r: GateRow, t: string, p: number) => string | null;
  }).rejectReason(row, trend, price);
}

const base: GateRow = {
  slot: 'primary',
  direction: 'long',
  entryLow: 100,
  entryHigh: 100,
  stopLoss: 98,
  takeProfit1: 106,
  takeProfit2: null
};

describe('SetupExtractionService quality gates (rejectReason)', () => {
  it('keeps a clean, trend-aligned, near-price, RR>=1.5 setup', () => {
    expect(reject(base, 'bullish', 100)).toBeNull();
  });

  it('rejects a setup with RR below 1.5', () => {
    // entry 100, SL 98 (risk 2), TP1 102 (reward 2) => RR 1.0
    expect(reject({ ...base, takeProfit1: 102 }, 'neutral', 100)).toMatch(/RR/);
  });

  it('falls back to TP2 when TP1 is missing for the RR gate', () => {
    expect(reject({ ...base, takeProfit1: null, takeProfit2: 101 }, 'neutral', 100)).toMatch(/RR/);
  });

  it('rejects a LONG that fades a bearish D1 trend', () => {
    expect(reject({ ...base, direction: 'long' }, 'bearish', 100)).toMatch(/counter-trend/);
  });

  it('rejects a SHORT that fades a bullish D1 trend', () => {
    const short: GateRow = { ...base, direction: 'short', stopLoss: 102, takeProfit1: 94 };
    expect(reject(short, 'bullish', 100)).toMatch(/counter-trend/);
  });

  it('allows both directions when the trend is neutral', () => {
    const short: GateRow = { ...base, direction: 'short', stopLoss: 102, takeProfit1: 94 };
    expect(reject(short, 'neutral', 100)).toBeNull();
  });

  it('rejects an entry too far from the current price', () => {
    // entry zone ~100, price 110 => ~9% away (> 3.5%)
    expect(reject(base, 'bullish', 110)).toMatch(/too far/);
  });

  it('skips the distance gate when current price is unknown (0)', () => {
    expect(reject(base, 'bullish', 0)).toBeNull();
  });

  it('rejects a zero-risk (entry == SL) setup', () => {
    expect(reject({ ...base, stopLoss: 100 }, 'neutral', 100)).toMatch(/stop-loss/);
  });
});
