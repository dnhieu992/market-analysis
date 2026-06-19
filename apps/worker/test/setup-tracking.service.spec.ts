import type { Candle } from '@app/core';

import { SetupTrackingService } from '../src/modules/setup-tracking/setup-tracking.service';

function candle(openTimeIso: string, low: number, high: number): Candle {
  const openTime = new Date(openTimeIso);
  return {
    openTime,
    closeTime: new Date(openTime.getTime() + 3_600_000 - 1),
    open: low,
    high,
    low,
    close: (low + high) / 2,
    volume: 1,
  } as Candle;
}

function pendingSetup(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    symbol: 'BTCUSDT',
    direction: 'short',
    slot: 'primary',
    planDate: new Date('2026-06-18T00:00:00.000Z'),
    entryLow: 100,
    entryHigh: 105,
    stopLoss: 110,
    takeProfit1: 90,
    takeProfit2: null,
    status: 'PENDING',
    lastCheckedAt: null,
    tp1HitAt: null,
    lastPrice: null,
    ...overrides,
  };
}

describe('SetupTrackingService.trackOpenSetups', () => {
  const update = jest.fn();
  const getCandles = jest.fn();
  let service: SetupTrackingService;

  beforeEach(() => {
    jest.clearAllMocks();
    const market = { getCandles } as any;
    const telegram = { sendAnalysisMessage: jest.fn().mockResolvedValue(undefined) } as any;
    service = new SetupTrackingService(market, telegram);
    (service as any).trackedSetupRepository = {
      listOpen: jest.fn(),
      update,
      listBySymbol: jest.fn(),
    };
  });

  it('does not fill a fresh setup on candles that closed before its plan day', async () => {
    (service as any).trackedSetupRepository.listOpen.mockResolvedValue([pendingSetup()]);
    // Pre-plan candle (16th) WOULD trigger a short entry (high >= entryLow); post-plan (18th) does not.
    getCandles.mockResolvedValue([
      candle('2026-06-16T01:00:00.000Z', 95, 108),
      candle('2026-06-18T01:00:00.000Z', 90, 95),
    ]);

    await service.trackOpenSetups();

    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0][1];
    expect(patch.status).toBeUndefined(); // still PENDING
    expect(patch.enteredAt).toBeUndefined();
  });

  it('fills on a post-plan candle that touches the entry zone', async () => {
    (service as any).trackedSetupRepository.listOpen.mockResolvedValue([pendingSetup({ id: 's2' })]);
    getCandles.mockResolvedValue([
      candle('2026-06-16T01:00:00.000Z', 80, 90), // pre-plan, irrelevant
      candle('2026-06-18T01:00:00.000Z', 98, 108), // post-plan: high 108 >= entryLow 100 → ENTERED
    ]);

    await service.trackOpenSetups();

    const patch = update.mock.calls[0][1];
    expect(patch.status).toBe('ENTERED');
    expect(patch.enteredAt).toEqual(new Date('2026-06-18T01:59:59.999Z'));
  });
});
