import { ResultMonitorService } from '../src/modules/day-trading/result-monitor.service';

const flush = () => new Promise((r) => setImmediate(r));

function baseSignal(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sig1',
    symbol: 'BTCUSDT',
    direction: 'LONG' as 'LONG' | 'SHORT',
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 102,
    breakEvenMoved: false,
    quantity: 0.1,
    rrRatio: 2,
    riskAmount: 2,
    ...over,
  };
}

function makeMonitor(signal: Record<string, unknown>, closeResult = true) {
  const repo = {
    closeActiveSignal: jest.fn().mockResolvedValue(closeResult),
    moveStopToBreakEven: jest.fn().mockResolvedValue(undefined),
    logAction: jest.fn().mockResolvedValue(undefined),
    findActiveSignals: jest.fn().mockResolvedValue([signal]),
  };
  const svc = new ResultMonitorService({} as any, {} as any);
  (svc as any).repo = repo;
  (svc as any).active = [signal];
  (svc as any).cacheAt = Date.now();
  return { svc, repo };
}

describe('ResultMonitorService.evaluate', () => {
  it('closes a LONG as TP_HIT when price reaches take-profit', async () => {
    const { svc, repo } = makeMonitor(baseSignal());
    await (svc as any).evaluate(103);
    expect(repo.closeActiveSignal).toHaveBeenCalledWith('sig1', expect.objectContaining({ status: 'TP_HIT' }));
  });

  it('closes a LONG as SL_HIT when price drops to the stop', async () => {
    const { svc, repo } = makeMonitor(baseSignal());
    await (svc as any).evaluate(98);
    expect(repo.closeActiveSignal).toHaveBeenCalledWith('sig1', expect.objectContaining({ status: 'SL_HIT' }));
  });

  it('closes a SHORT as TP_HIT when price falls to take-profit', async () => {
    const signal = baseSignal({ direction: 'SHORT', stopLoss: 101, takeProfit: 98 });
    const { svc, repo } = makeMonitor(signal);
    await (svc as any).evaluate(97);
    expect(repo.closeActiveSignal).toHaveBeenCalledWith('sig1', expect.objectContaining({ status: 'TP_HIT' }));
  });

  it('moves the stop to break-even at +1R without closing', async () => {
    const signal = baseSignal(); // entry 100, sl 99 → riskDist 1 → +1R at 101
    const { svc, repo } = makeMonitor(signal);
    await (svc as any).evaluate(101);
    await flush();
    expect(repo.moveStopToBreakEven).toHaveBeenCalledWith('sig1', 100);
    expect(repo.closeActiveSignal).not.toHaveBeenCalled();
  });

  it('does not double-close when it loses the race (closeActiveSignal returns false)', async () => {
    // breakEvenMoved=true so the +1R BE path doesn't fire — isolate the close race.
    const { svc, repo } = makeMonitor(baseSignal({ breakEvenMoved: true }), false);
    await (svc as any).evaluate(103);
    expect(repo.closeActiveSignal).toHaveBeenCalledTimes(1);
    // Lost the race → no CLOSED audit written.
    expect(repo.logAction).not.toHaveBeenCalled();
  });

  it('ignores non-finite prices', async () => {
    const { svc, repo } = makeMonitor(baseSignal());
    await (svc as any).onTick(Number.NaN);
    expect(repo.closeActiveSignal).not.toHaveBeenCalled();
  });
});
