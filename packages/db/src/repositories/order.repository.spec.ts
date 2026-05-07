import { createOrderRepository } from './order.repository';

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    order: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { pnl: null } }),
      groupBy: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
      ...overrides,
    },
  } as unknown as Parameters<typeof createOrderRepository>[0];
}

describe('listFiltered', () => {
  it('returns empty result when no orders exist', async () => {
    const repo = createOrderRepository(makeMockClient());
    const result = await repo.listFiltered({ page: 1, pageSize: 20 });
    expect(result).toEqual({ data: [], total: 0, closedPnlSum: 0, openOrders: [] });
  });

  it('passes page and pageSize as skip/take to findMany', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = createOrderRepository(makeMockClient({ findMany }));
    await repo.listFiltered({ page: 3, pageSize: 10 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });

  it('applies symbol contains filter', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const repo = createOrderRepository(makeMockClient({ findMany, count }));
    await repo.listFiltered({ symbol: 'BTC', page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ symbol: { contains: 'BTC' } }) })
    );
  });

  it('applies status exact filter', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const repo = createOrderRepository(makeMockClient({ findMany, count }));
    await repo.listFiltered({ status: 'open', page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'open' }) })
    );
  });

  it('applies brokers IN filter', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const repo = createOrderRepository(makeMockClient({ findMany, count }));
    await repo.listFiltered({ brokers: ['Binance', 'Bybit'], page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ broker: { in: ['Binance', 'Bybit'] } }) })
    );
  });

  it('returns closedPnlSum from aggregate', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { pnl: 420.5 } });
    const repo = createOrderRepository(makeMockClient({ aggregate }));
    const result = await repo.listFiltered({ page: 1, pageSize: 20 });
    expect(result.closedPnlSum).toBe(420.5);
  });

  it('returns 0 for closedPnlSum when aggregate pnl is null', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { pnl: null } });
    const repo = createOrderRepository(makeMockClient({ aggregate }));
    const result = await repo.listFiltered({ page: 1, pageSize: 20 });
    expect(result.closedPnlSum).toBe(0);
  });

  it('applies dateFrom as openedAt gte filter', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const repo = createOrderRepository(makeMockClient({ findMany, count }));
    const dateFrom = new Date('2025-01-01');
    await repo.listFiltered({ dateFrom, page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ openedAt: { gte: dateFrom } }) })
    );
  });

  it('applies dateTo as openedAt lte filter', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const repo = createOrderRepository(makeMockClient({ findMany, count }));
    const dateTo = new Date('2025-05-01');
    await repo.listFiltered({ dateTo, page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ openedAt: { lte: dateTo } }) })
    );
  });

  it('applies both dateFrom and dateTo as openedAt range', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const repo = createOrderRepository(makeMockClient({ findMany, count }));
    const dateFrom = new Date('2025-01-01');
    const dateTo = new Date('2025-05-01');
    await repo.listFiltered({ dateFrom, dateTo, page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ openedAt: { gte: dateFrom, lte: dateTo } }) })
    );
  });

  it('skips openOrders query when status=closed', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = createOrderRepository(makeMockClient({ findMany }));
    await repo.listFiltered({ status: 'closed', page: 1, pageSize: 20 });
    // findMany called only once (for data), not again for openOrders
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('listDistinctBrokers', () => {
  it('returns sorted distinct broker names', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { broker: 'Binance' },
      { broker: 'Bybit' },
    ]);
    const repo = createOrderRepository(makeMockClient({ groupBy }));
    const result = await repo.listDistinctBrokers();
    expect(result).toEqual(['Binance', 'Bybit']);
  });

  it('returns empty array when no brokers exist', async () => {
    const repo = createOrderRepository(makeMockClient());
    const result = await repo.listDistinctBrokers();
    expect(result).toEqual([]);
  });
});
