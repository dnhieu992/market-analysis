import { computeStats, normalizeTrades } from '../src/modules/backtest-lab/backtest-stats';
import type { SandboxCandle } from '../src/modules/backtest-lab/kline-loader';

const H = 3_600_000;
const candle = (i: number, o: number, h: number, l: number, c: number): SandboxCandle => ({
  time: i * H,
  closeTime: (i + 1) * H - 1,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
});

// 0..5: price wanders 100 → up to 120 → back down to 90
const series = [
  candle(0, 100, 101, 99, 100),
  candle(1, 100, 110, 100, 108),
  candle(2, 108, 120, 105, 115),
  candle(3, 115, 116, 95, 96),
  candle(4, 96, 97, 90, 92),
  candle(5, 92, 93, 91, 92),
];
const finest = { BTCUSDT: series };

describe('backtest stats', () => {
  it('prices a short with fees and measures MAE against the entry', () => {
    const { trades, errors } = normalizeTrades(
      [{ symbol: 'BTCUSDT', side: 'short', entryTime: 1 * H, entryPrice: 100, exitTime: 4 * H + 1, exitPrice: 90, sizeUsd: 100 }],
      { symbols: ['BTCUSDT'], finest, feePctPerSide: 0.05 },
    );
    expect(errors).toEqual([]);
    const t = trades[0]!;
    // 1 coin short from 100 to 90 = +10 gross; fees 0.05% of 100 + 0.05% of 90
    expect(t.grossUsd).toBeCloseTo(10, 6);
    expect(t.feesUsd).toBeCloseTo(0.05 + 0.045, 6);
    expect(t.netUsd).toBeCloseTo(9.905, 6);
    // worst high while held = 120 → 20% against the short
    expect(t.maePct).toBeCloseTo(20, 6);
    expect(t.mfePct).toBeCloseTo(10, 6);
  });

  it('averages DCA fills by coins, not by price', () => {
    const { trades } = normalizeTrades(
      [{ symbol: 'BTCUSDT', side: 'short', entries: [{ time: 1 * H, price: 100, sizeUsd: 100 }, { time: 2 * H, price: 120, sizeUsd: 120 }], exitTime: 4 * H, exitPrice: 100 }],
      { symbols: ['BTCUSDT'], finest, feePctPerSide: 0 },
    );
    const t = trades[0]!;
    expect(t.fills).toBe(2);
    expect(t.coins).toBeCloseTo(2, 9); // 1 + 1 coin
    expect(t.avgEntry).toBeCloseTo(110, 9);
    expect(t.netUsd).toBeCloseTo(20, 9); // 2 coins × (110 − 100)
  });

  it('marks a trade without exit to the last close and keeps it out of the closed stats', () => {
    const { trades } = normalizeTrades(
      [
        { side: 'short', entryTime: 0, entryPrice: 100, exitTime: 2 * H, exitPrice: 95 },
        { side: 'short', entryTime: 3 * H, entryPrice: 100, exitTime: null },
      ],
      { symbols: ['BTCUSDT'], finest, feePctPerSide: 0 },
    );
    expect(trades[1]!.open).toBe(true);
    expect(trades[1]!.exitPrice).toBe(92);
    const stats = computeStats(trades, { capitalUsd: 1000 });
    expect(stats.closed.trades).toBe(1);
    expect(stats.open.trades).toBe(1);
    expect(stats.open.unrealizedUsd).toBeCloseTo(8, 2);
  });

  it('rejects malformed trades with a readable reason', () => {
    const r = normalizeTrades(
      [
        { symbol: 'BTCUSDT', side: 'sell', entryTime: 0, entryPrice: 100, exitTime: H, exitPrice: 99 },
        { symbol: 'BTCUSDT', side: 'short', entryTime: 2 * H, entryPrice: 100, exitTime: H, exitPrice: 99 },
      ],
      { symbols: ['BTCUSDT'], finest, feePctPerSide: 0.05 },
    );
    expect(r.trades).toHaveLength(0);
    expect(r.invalid).toBe(2);
    expect(r.errors[0]).toContain('side');
    expect(r.errors[1]).toContain('exitTime');
  });

  it('computes win rate, drawdown and losing streak on closed trades in exit order', () => {
    const mk = (i: number, exit: number) => ({ symbol: 'BTCUSDT', side: 'long', entryTime: i * H, entryPrice: 100, exitTime: i * H + 1, exitPrice: exit, sizeUsd: 100 });
    const { trades } = normalizeTrades([mk(0, 110), mk(1, 95), mk(2, 90), mk(3, 105)], { symbols: ['BTCUSDT'], finest, feePctPerSide: 0 });
    const s = computeStats(trades, { capitalUsd: 1000 });
    expect(s.closed.trades).toBe(4);
    expect(s.closed.winRatePct).toBe(50);
    expect(s.closed.netPnlUsd).toBe(0); // +10 −5 −10 +5
    expect(s.closed.maxDrawdownUsd).toBe(15); // peak 1010 → 995
    expect(s.closed.maxConsecutiveLosses).toBe(2);
    expect(s.closed.profitFactor).toBe(1); // 15 won / 15 lost
  });
});
