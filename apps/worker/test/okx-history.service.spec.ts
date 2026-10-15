const orders = new Map<string, any>();
const orderRepo = {
  findByExternalId: jest.fn(async (ext: string) => [...orders.values()].find((o) => o.externalId === ext) ?? null),
  update: jest.fn(async (id: string, data: any) => Object.assign(orders.get(id), data)),
  create: jest.fn(async (data: any) => {
    const id = `new-${orders.size}`;
    orders.set(id, { id, ...data });
  }),
  listOpenBySource: jest.fn(async () => [...orders.values()].filter((o) => o.status === 'open')),
};
jest.mock('@app/db', () => ({
  createOrderRepository: () => orderRepo,
  createOkxOrderSyncStateRepository: () => ({
    get: async () => ({ historyStartAt: new Date(0), baseline: ['okx-1'] }),
  }),
}));

import { OkxHistoryService } from '../src/modules/okx-history/okx-history.service';

const CLOSE_MS = Date.parse('2026-10-15T04:36:46Z');
const REOPEN_MS = Date.parse('2026-10-15T12:56:38Z');

function makeService(history: any[]) {
  process.env.OKX_API_KEY = process.env.OKX_API_SECRET = process.env.OKX_API_PASSPHRASE = 'x';
  const svc = new OkxHistoryService();
  (svc as any).signedGet = jest.fn(async (path: string) => {
    if (path.endsWith('/positions'))
      return [{ posId: '1', instId: 'ETH-USDT-SWAP', posSide: 'short', pos: '0.08', avgPx: '2351.58', lever: '2', cTime: String(REOPEN_MS) }];
    if (path.endsWith('/positions-history')) return history;
    return [{ instId: 'ETH-USDT-SWAP', ctVal: '0.1' }];
  });
  return svc;
}

const closedRow = { posId: '1', closeAvgPx: '2384.49', realizedPnl: '10.15', uTime: String(CLOSE_MS) };

describe('OkxHistoryService — recycled posId', () => {
  beforeEach(() => orders.clear());

  it('keeps a closed trade and ingests the new position when OKX reuses the posId', async () => {
    orders.set('old', {
      id: 'old', externalId: 'okx-1', symbol: 'ETHUSDT', side: 'short', status: 'closed',
      entryPrice: 2504.59, openedAt: new Date('2026-08-21T07:51:31Z'), closedAt: new Date(CLOSE_MS),
    });
    await makeService([closedRow]).sync();
    expect(orders.get('old')).toMatchObject({ status: 'closed', externalId: `okx-1-${CLOSE_MS}`, entryPrice: 2504.59 });
    expect([...orders.values()].find((o) => o.externalId === 'okx-1')).toMatchObject({ status: 'open', entryPrice: 2351.58 });
  });

  it('closes the old row when close + re-open happen between two syncs', async () => {
    orders.set('old', {
      id: 'old', externalId: 'okx-1', symbol: 'ETHUSDT', side: 'short', status: 'open',
      entryPrice: 2504.59, openedAt: new Date('2026-08-21T07:51:31Z'), closedAt: null,
    });
    await makeService([closedRow]).sync();
    expect(orders.get('old')).toMatchObject({ status: 'closed', closePrice: 2384.49, pnl: 10.15, externalId: `okx-1-${CLOSE_MS}` });
    expect([...orders.values()].find((o) => o.externalId === 'okx-1')).toMatchObject({ status: 'open', entryPrice: 2351.58 });
  });

  it('still reconciles a manually-linked open row when no close happened', async () => {
    orders.set('old', {
      id: 'old', externalId: 'okx-1', symbol: 'ETHUSDT', side: 'short', status: 'open',
      entryPrice: 2340, openedAt: new Date(REOPEN_MS - 600_000), closedAt: null,
    });
    await makeService([]).sync();
    expect(orders.size).toBe(1);
    expect(orders.get('old')).toMatchObject({ status: 'open', entryPrice: 2351.58, externalId: 'okx-1' });
  });
});
