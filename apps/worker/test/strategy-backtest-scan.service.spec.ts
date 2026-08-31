import type { Candle } from '@app/core';

import { replaySetup } from '../src/modules/strategy-backtest/strategy-backtest-scan.service';
import type { StrategyBacktestSetupRow } from '../src/modules/strategy-backtest/strategy-backtest-scan.service';

const CREATED_AT = new Date('2026-08-30T00:00:00.000Z');

function candle(minuteOffset: number, high: number, low: number, close = low): Candle {
  const openTime = new Date(CREATED_AT.getTime() + minuteOffset * 60_000);
  return {
    open: high,
    high,
    low,
    close,
    volume: 1,
    openTime,
    closeTime: new Date(openTime.getTime() + 5 * 60_000 - 1)
  };
}

function setup(overrides: Partial<StrategyBacktestSetupRow> = {}): StrategyBacktestSetupRow {
  return {
    id: 'setup-1',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    note: null,
    status: 'PENDING',
    triggeredAt: null,
    closedAt: null,
    exitPrice: null,
    pnlPct: null,
    rMultiple: null,
    lastPrice: null,
    lastCheckedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides
  } as StrategyBacktestSetupRow;
}

describe('replaySetup', () => {
  it('leaves a setup PENDING while price never reaches the limit', () => {
    const update = replaySetup(setup(), [candle(0, 115, 105), candle(5, 112, 101)]);

    expect(update.status).toBeUndefined();
    expect(update.triggeredAt).toBeUndefined();
  });

  it('fills a LONG limit when a candle low trades through the entry', () => {
    const update = replaySetup(setup(), [candle(0, 110, 99)]);

    expect(update.status).toBe('ENTERED');
    expect(update.closedAt).toBeUndefined();
  });

  it('fills a SHORT limit when a candle high trades through the entry', () => {
    const update = replaySetup(
      setup({ direction: 'SHORT', entryPrice: 100, stopLoss: 110, takeProfit: 80 }),
      [candle(0, 101, 95)]
    );

    expect(update.status).toBe('ENTERED');
  });

  it('closes at the take profit and scores it in percent and R', () => {
    const update = replaySetup(setup({ status: 'ENTERED' }), [candle(0, 121, 115)]);

    expect(update.status).toBe('TP_HIT');
    expect(update.exitPrice).toBe(120);
    // +20% gross on a $100 entry, minus 0.05%/side round trip.
    expect(update.pnlPct).toBeCloseTo(19.9, 6);
    // Risk is 10 points, reward 20 → 2R (fees excluded from R on purpose).
    expect(update.rMultiple).toBeCloseTo(2, 6);
  });

  it('closes at the stop loss with a negative result', () => {
    const update = replaySetup(setup({ status: 'ENTERED' }), [candle(0, 105, 89)]);

    expect(update.status).toBe('SL_HIT');
    expect(update.exitPrice).toBe(90);
    expect(update.pnlPct).toBeCloseTo(-10.1, 6);
    expect(update.rMultiple).toBeCloseTo(-1, 6);
  });

  // Intra-candle order is unknowable from OHLC, so the pessimistic read is the only
  // one that cannot flatter the trader's win rate.
  it('scores a candle that touches both the stop and the target as a stop', () => {
    const update = replaySetup(setup({ status: 'ENTERED' }), [candle(0, 125, 85)]);

    expect(update.status).toBe('SL_HIT');
  });

  it('can fill and stop out inside the same candle', () => {
    const update = replaySetup(setup(), [candle(0, 105, 88)]);

    expect(update.triggeredAt).toBeDefined();
    expect(update.status).toBe('SL_HIT');
  });

  // Without this guard a setup written now would fill against candles that closed
  // before it existed, inventing trades the trader never planned.
  it('ignores candles that closed before the setup was created', () => {
    const stale = candle(-60, 110, 80);

    const update = replaySetup(setup(), [stale]);

    expect(update.status).toBeUndefined();
  });

  it('ignores candles already covered by the watermark', () => {
    const seen = candle(0, 110, 80);
    const update = replaySetup(
      setup({ lastCheckedAt: new Date(seen.closeTime!.getTime() + 1) }),
      [seen]
    );

    expect(update.status).toBeUndefined();
  });

  it('runs a setup without a take profit until the stop, never closing on an up move', () => {
    const update = replaySetup(setup({ status: 'ENTERED', takeProfit: null }), [
      candle(0, 500, 150)
    ]);

    expect(update.status).toBeUndefined();
    expect(update.closedAt).toBeUndefined();
  });
});
