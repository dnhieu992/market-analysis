import { DayTradingService } from '../src/modules/day-trading/day-trading.service';
import type { SetupResult } from '../src/modules/day-trading/setup-analyzer.service';

const candle = { timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 };

function buildSetup(direction: 'LONG' | 'SHORT'): SetupResult {
  return {
    setupType: 'TREND_PULLBACK',
    direction,
    entryPrice: 100,
    stopLoss: direction === 'LONG' ? 99 : 101,
    takeProfit: direction === 'LONG' ? 102 : 98,
    rrRatio: 2,
    riskAmount: 2,
    quantity: 0.1,
    positionValue: 10,
    setupJson: '{}',
  };
}

type OpenSignal = { id: string; direction: 'LONG' | 'SHORT' };

function makeService(opts: { open: OpenSignal[]; setup: SetupResult | null; ws?: Record<string, unknown> }) {
  const executor = { execute: jest.fn().mockResolvedValue(undefined) };
  const analyzer = { analyze: jest.fn().mockReturnValue(opts.setup) };
  const bitget = { fetchCandles: jest.fn().mockResolvedValue([candle]) };
  const ws = opts.ws ?? {};
  const monitor = {};

  const repo = {
    getSettings: jest.fn().mockResolvedValue({ maxTradesPerDay: 5, maxLossesPerDay: 2, riskPerTrade: 2, minRR: 2 }),
    findActiveSignals: jest.fn().mockResolvedValue(opts.open),
    countTodaySignals: jest.fn().mockResolvedValue(0),
    countTodayLosses: jest.fn().mockResolvedValue(0),
    lastLossClosedAt: jest.fn().mockResolvedValue(null),
    findLatestSignal: jest.fn().mockResolvedValue(null),
    logAction: jest.fn().mockResolvedValue(undefined),
  };

  const service = new DayTradingService(bitget as any, ws as any, analyzer as any, executor as any, monitor as any);
  (service as any).repo = repo;
  return { service, executor, analyzer, repo, ws };
}

describe('DayTradingService.scan — one-open-position-per-side rule', () => {
  it('opens a LONG while a SHORT is already running (opposite side allowed)', async () => {
    const { service, executor } = makeService({
      open: [{ id: 's1', direction: 'SHORT' }],
      setup: buildSetup('LONG'),
    });
    await service.scan();
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute.mock.calls[0][1].direction).toBe('LONG');
  });

  it('blocks a second SHORT while a SHORT is already running (same side forbidden)', async () => {
    const { service, executor } = makeService({
      open: [{ id: 's1', direction: 'SHORT' }],
      setup: buildSetup('SHORT'),
    });
    await service.scan();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('short-circuits before analysis when both sides are already open', async () => {
    const { service, executor, analyzer } = makeService({
      open: [{ id: 's1', direction: 'LONG' }, { id: 's2', direction: 'SHORT' }],
      setup: buildSetup('LONG'),
    });
    await service.scan();
    expect(analyzer.analyze).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('opens normally when no position is open', async () => {
    const { service, executor } = makeService({ open: [], setup: buildSetup('LONG') });
    await service.scan();
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('does not open when no setup is detected', async () => {
    const { service, executor } = makeService({ open: [], setup: null });
    await service.scan();
    expect(executor.execute).not.toHaveBeenCalled();
  });
});

describe('DayTradingService.cronFallbackScan — keyed on candleClose staleness', () => {
  it('runs a scan when the realtime candleClose trigger is stale', async () => {
    const { service, executor } = makeService({
      open: [], setup: buildSetup('LONG'),
      ws: { isCandleCloseStale: jest.fn().mockReturnValue(true) },
    });
    await service.cronFallbackScan();
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('skips when a recent candleClose already fired (avoids double scan)', async () => {
    const { service, analyzer, executor } = makeService({
      open: [], setup: buildSetup('LONG'),
      ws: { isCandleCloseStale: jest.fn().mockReturnValue(false) },
    });
    await service.cronFallbackScan();
    expect(analyzer.analyze).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('does NOT consult ws.isHealthy() — a ticker-healthy socket must not block the fallback', async () => {
    const isHealthy = jest.fn().mockReturnValue(true);
    const { service, executor } = makeService({
      open: [], setup: buildSetup('LONG'),
      ws: { isCandleCloseStale: jest.fn().mockReturnValue(true), isHealthy },
    });
    await service.cronFallbackScan();
    expect(isHealthy).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
});
