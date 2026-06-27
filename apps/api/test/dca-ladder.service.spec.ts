import { DcaLadderService } from '../src/modules/dca-ladder/dca-ladder.service';

type Order = any;
type Cycle = any;

function makeFakeRepo() {
  const settings = {
    id: 'singleton', symbol: 'BTCUSDT', startCapital: 1000,
    firstTierPct: 5, numTiers: 10, stepPct: 1.5, tpPct: 10, feePct: 0, enabled: true,
  };
  const cycles: Cycle[] = [];
  const orders: Order[] = [];
  let oid = 0;
  return {
    settings, cycles, orders,
    getSettings: async () => settings,
    updateSettings: async (d: any) => Object.assign(settings, d),
    getCurrentCycle: async (s: string) =>
      cycles.filter((c) => c.symbol === s && c.status !== 'CLOSED').sort((a, b) => b.cycleNumber - a.cycleNumber)[0] ?? null,
    getCycleWithOrders: async (id: string) => ({ ...cycles.find((c) => c.id === id), orders: orders.filter((o) => o.cycleId === id) }),
    createCycle: async (d: any) => { const c = { id: `c${cycles.length}`, ...d, avgCost: null, positionSize: null, tpPrice: null, realizedPnl: null, closedAt: null }; cycles.push(c); return c; },
    updateCycle: async (id: string, d: any) => Object.assign(cycles.find((c) => c.id === id), d),
    createOrders: async (os: any[]) => { for (const o of os) orders.push({ id: `o${oid++}`, fillPrice: null, qty: null, filledAt: null, ...o }); },
    deleteOrdersByCycle: async (cid: string) => { for (let i = orders.length - 1; i >= 0; i--) if (orders[i].cycleId === cid) orders.splice(i, 1); },
    getOrdersByCycle: async (cid: string) => orders.filter((o) => o.cycleId === cid),
    getOrder: async (id: string) => orders.find((o) => o.id === id) ?? null,
    updateOrder: async (id: string, d: any) => Object.assign(orders.find((o) => o.id === id), d),
    listClosedCycles: async (s: string) => cycles.filter((c) => c.symbol === s && c.status === 'CLOSED'),
    listAllCycles: async (s: string) => cycles.filter((c) => c.symbol === s),
  };
}

describe('DcaLadderService state machine', () => {
  function makeService(repo: any) {
    const svc = new DcaLadderService();
    (svc as any).repo = repo;
    (svc as any).fetchSeedPeak = async () => 100_000; // stub Binance
    (svc as any).fetchLivePrice = async () => 95_000;
    return svc;
  }

  it('bootstraps a FLAT cycle with 10 armed buy tiers', async () => {
    const repo = makeFakeRepo();
    const svc = makeService(repo);
    const state = await svc.getState();
    expect(state.cycle.status).toBe('FLAT');
    expect(state.orders.filter((o: any) => o.side === 'BUY' && o.status === 'ARMED')).toHaveLength(10);
    expect(state.orders[0]!.plannedPrice).toBeCloseTo(95_000, 3); // -5% of 100k
    expect(state.orders[0]!.usdAmount).toBeCloseTo(100, 6); // 1000/10
  });

  it('first buy fill flips to IN_POSITION, freezes peak, arms TP', async () => {
    const repo = makeFakeRepo();
    const svc = makeService(repo);
    await svc.getState();
    const buy0 = repo.orders.find((o: any) => o.side === 'BUY' && o.tierIndex === 0);
    const state = await svc.fillOrder(buy0.id, 95_000);
    expect(state.cycle.status).toBe('IN_POSITION');
    expect(state.cycle.peak).toBeCloseTo(100_000, 3);
    expect(state.cycle.avgCost).toBeCloseTo(95_000, 3); // fee 0
    const sell = state.orders.find((o: any) => o.side === 'SELL');
    expect(sell!.status).toBe('ARMED');
    expect(sell!.plannedPrice).toBeCloseTo(95_000 * 1.1, 3);
  });

  it('closing realizes pnl and opens a compounded next cycle', async () => {
    const repo = makeFakeRepo();
    const svc = makeService(repo);
    await svc.getState();
    const buy0 = repo.orders.find((o: any) => o.side === 'BUY' && o.tierIndex === 0);
    await svc.fillOrder(buy0.id, 95_000); // qty ~ 100/95000
    const state = await svc.closeCycle(95_000 * 1.1);
    const closed = repo.cycles.find((c: any) => c.status === 'CLOSED');
    expect(closed.realizedPnl).toBeCloseTo((100 / 95_000) * (95_000 * 1.1) - 100, 6);
    expect(state.cycle.status).toBe('FLAT'); // next cycle
    expect(state.cycle.cycleNumber).toBe(2);
    expect(state.cycle.budget).toBeCloseTo(1000 + closed.realizedPnl, 6);
    expect(state.summary.cycleCount).toBe(2);
    expect(state.summary.realizedPnl).toBeCloseTo(closed.realizedPnl, 6);
  });

  it('unfilling the only buy returns the cycle to FLAT', async () => {
    const repo = makeFakeRepo();
    const svc = makeService(repo);
    await svc.getState();
    const buy0 = repo.orders.find((o: any) => o.side === 'BUY' && o.tierIndex === 0);
    await svc.fillOrder(buy0.id, 95_000);
    const state = await svc.unfillOrder(buy0.id);
    expect(state.cycle.status).toBe('FLAT');
    expect(state.cycle.avgCost).toBeNull();
    expect(state.orders.find((o: any) => o.side === 'SELL')!.status).toBe('CANCELLED');
  });
});
