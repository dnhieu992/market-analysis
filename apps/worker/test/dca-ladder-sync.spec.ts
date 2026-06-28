import { DcaLadderSyncService } from '../src/modules/dca-ladder/dca-ladder.service';

function kline(high: number, low: number): any {
  // [openTime, open, high, low, close, volume, closeTime, ...]
  return [0, '0', String(high), String(low), '0', '0', 0];
}

function makeRepo(over: any = {}) {
  const settings = { symbol: 'BTCUSDT', firstTierPct: 5, bearFirstTierPct: 10, numTiers: 10, stepPct: 1.5, tpPct: 10, feePct: 0, enabled: true };
  const cycle = { id: 'c1', symbol: 'BTCUSDT', status: 'FLAT', peak: 100_000, tpPrice: null, ...over.cycle };
  const orders = over.orders ?? [
    { id: 'o0', cycleId: 'c1', side: 'BUY', tierIndex: 0, plannedPrice: 95_000, status: 'ARMED' },
    { id: 'o1', cycleId: 'c1', side: 'BUY', tierIndex: 1, plannedPrice: 93_500, status: 'ARMED' },
  ];
  const updatedOrders: any[] = [];
  const updatedCycle: any[] = [];
  return {
    settings, cycle, orders, updatedOrders, updatedCycle,
    getSettings: async () => settings,
    getCurrentCycle: async () => cycle,
    getOrdersByCycle: async () => orders,
    updateOrder: async (id: string, d: any) => { updatedOrders.push({ id, ...d }); Object.assign(orders.find((o: any) => o.id === id), d); },
    updateCycle: async (id: string, d: any) => { updatedCycle.push({ id, ...d }); Object.assign(cycle, d); },
  };
}

function makeService(repo: any, klines: any[], telegram: { sent: string[] }) {
  const svc = new DcaLadderSyncService(
    { fetchKlines: async () => klines } as any,
    { sendToChat: async (t: string) => { telegram.sent.push(t); } } as any,
  );
  (svc as any).repo = repo;
  return svc;
}

describe('DcaLadderSyncService', () => {
  it('marks a tier PENDING_FILL when the daily low pierces it and alerts once', async () => {
    const repo = makeRepo();
    const telegram = { sent: [] as string[] };
    // closed candle = index -2; provide 2 candles, low 94000 pierces tier0 (95000) only
    const svc = makeService(repo, [kline(101_000, 94_000), kline(100_000, 99_000)], telegram);
    const res = await svc.syncDaily();
    expect(res.touchedTiers).toEqual([0]);
    expect(repo.orders.find((o: any) => o.id === 'o0').status).toBe('PENDING_FILL');
    expect(repo.orders.find((o: any) => o.id === 'o1').status).toBe('ARMED');
    expect(telegram.sent).toHaveLength(1);
  });

  it('does nothing (no telegram) when no tier is touched', async () => {
    const repo = makeRepo();
    const telegram = { sent: [] as string[] };
    const svc = makeService(repo, [kline(101_000, 96_000), kline(100_000, 99_000)], telegram);
    const res = await svc.syncDaily();
    expect(res.changed).toBe(false);
    expect(telegram.sent).toHaveLength(0);
  });

  it('flags TP ready when IN_POSITION and high >= tpPrice', async () => {
    const repo = makeRepo({
      cycle: { status: 'IN_POSITION', peak: 100_000, tpPrice: 90_000 },
      orders: [{ id: 's0', cycleId: 'c1', side: 'SELL', tierIndex: null, plannedPrice: 90_000, status: 'ARMED' }],
    });
    const telegram = { sent: [] as string[] };
    const svc = makeService(repo, [kline(91_000, 89_000), kline(90_500, 90_000)], telegram);
    const res = await svc.syncDaily();
    expect(res.tpReady).toBe(true);
    expect(repo.orders.find((o: any) => o.id === 's0').status).toBe('PENDING_FILL');
    expect(telegram.sent).toHaveLength(1);
  });

  it('re-arms ARMED tier prices each FLAT day using the weekly-adaptive first tier', async () => {
    const repo = makeRepo();
    const telegram = { sent: [] as string[] };
    // closed candle high 101_000 (raises peak), low 99_500 pierces nothing
    const svc = makeService(repo, [kline(101_000, 99_500), kline(100_000, 99_000)], telegram);
    (svc as any).resolveFirstTierPct = async () => 10; // weekly bear → deep first tier
    await svc.syncDaily();
    // newPeak 101_000; tier0 = 101_000 * (1 - 10/100); tier1 = 101_000 * (1 - 11.5/100)
    expect(repo.orders.find((o: any) => o.id === 'o0').plannedPrice).toBeCloseTo(90_900, 3);
    expect(repo.orders.find((o: any) => o.id === 'o1').plannedPrice).toBeCloseTo(89_385, 3);
  });

  it('respects disabled settings', async () => {
    const repo = makeRepo();
    repo.settings.enabled = false;
    const telegram = { sent: [] as string[] };
    const svc = makeService(repo, [kline(101_000, 90_000), kline(100_000, 99_000)], telegram);
    const res = await svc.syncDaily();
    expect(res.changed).toBe(false);
    expect(telegram.sent).toHaveLength(0);
  });
});
