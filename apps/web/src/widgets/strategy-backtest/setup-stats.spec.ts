import type { StrategyBacktestSetup, StrategyBacktestStatus } from '@web/shared/api/types';

import { computeSetupStats } from './setup-stats';

function setup(
  status: StrategyBacktestStatus,
  overrides: Partial<StrategyBacktestSetup> = {},
): StrategyBacktestSetup {
  return {
    id: Math.random().toString(36).slice(2),
    symbol: 'BTCUSDT',
    direction: 'LONG',
    setupType: 'SWING',
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    note: null,
    images: [],
    status,
    triggeredAt: null,
    closedAt: null,
    exitPrice: null,
    pnlPct: null,
    rMultiple: null,
    lastPrice: null,
    lastCheckedAt: null,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    plannedRr: 2,
    distanceToEntryPct: null,
    unrealizedPct: null,
    unrealizedR: null,
    ...overrides,
  };
}

describe('computeSetupStats', () => {
  it('reports empty ratios when nothing has been scored yet', () => {
    const stats = computeSetupStats([setup('PENDING'), setup('ENTERED')]);

    expect(stats.planned).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.open).toBe(1);
    expect(stats.scored).toBe(0);
    expect(stats.winRate).toBeNull();
    expect(stats.totalR).toBeNull();
  });

  it('scores wins, losses and R over the finished setups', () => {
    const stats = computeSetupStats([
      setup('TP_HIT', { pnlPct: 19.9, rMultiple: 2 }),
      setup('SL_HIT', { pnlPct: -10.1, rMultiple: -1 }),
      setup('CLOSED', { pnlPct: 4.9, rMultiple: 0.5 }),
    ]);

    expect(stats.scored).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(2 / 3, 6);
    expect(stats.totalR).toBeCloseTo(1.5, 6);
    expect(stats.avgR).toBeCloseTo(0.5, 6);
    expect(stats.totalPnlPct).toBeCloseTo(14.7, 6);
  });

  // A cancelled setup never risked anything and an open one has not resolved —
  // counting either would make the win rate mean something it does not.
  it('leaves cancelled and still-open setups out of every ratio', () => {
    const stats = computeSetupStats([
      setup('TP_HIT', { pnlPct: 10, rMultiple: 1 }),
      setup('CANCELLED'),
      setup('ENTERED'),
      setup('PENDING'),
    ]);

    expect(stats.scored).toBe(1);
    expect(stats.winRate).toBe(1);
    // Fill rate ignores the cancelled setup: 2 of the 3 real setups reached the limit.
    expect(stats.fillRate).toBeCloseTo(2 / 3, 6);
  });

  // A setup called off mid-flight must not land in the win/loss column either way —
  // the trader abandoned the reasoning, so it never produced a verdict to score.
  it('drops setups marked invalid, even ones that had already filled', () => {
    const stats = computeSetupStats([
      setup('TP_HIT', { pnlPct: 10, rMultiple: 1 }),
      setup('INVALID'),
      setup('PENDING'),
    ]);

    expect(stats.dropped).toBe(1);
    expect(stats.scored).toBe(1);
    expect(stats.wins).toBe(1);
    // Only the TP_HIT and the PENDING setup are still counted.
    expect(stats.fillRate).toBeCloseTo(0.5, 6);
  });

  it('counts a break-even close as a loss rather than a win', () => {
    const stats = computeSetupStats([setup('CLOSED', { pnlPct: 0, rMultiple: 0 })]);

    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(1);
  });
});
