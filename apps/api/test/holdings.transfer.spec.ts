import { BadRequestException, NotFoundException } from '@nestjs/common';

const prismaMock = {
  coinTransaction: {
    findMany: jest.fn(),
    createMany: jest.fn(),
    updateMany: jest.fn()
  },
  portfolio: {
    findMany: jest.fn()
  },
  holding: {
    deleteMany: jest.fn(),
    upsert: jest.fn()
  },
  $transaction: jest.fn()
};

jest.mock('@app/db', () => ({ prisma: prismaMock }));

// Imported after the mock so the service picks up the fake prisma.
import { HoldingsService } from '../src/modules/holdings/holdings.service';

const SOURCE = 'portfolio-source';
const TARGET = 'portfolio-target';

function createService(holding: { totalAmount: number; avgCost: number } | null) {
  const repository = {
    findByPortfolioAndCoin: jest.fn().mockResolvedValue(holding)
  };
  return new HoldingsService(repository as never);
}

describe('HoldingsService.transferCoin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.coinTransaction.findMany.mockResolvedValue([]);
    prismaMock.coinTransaction.createMany.mockResolvedValue({ count: 2 });
    prismaMock.coinTransaction.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.portfolio.findMany.mockResolvedValue([
      { id: SOURCE, name: 'BTC&ETH(70%)' },
      { id: TARGET, name: 'TRADING' }
    ]);
    // recalculate() runs its work inside a transaction — hand it the same fake client.
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        holding: prismaMock.holding,
        coinTransaction: { findMany: jest.fn().mockResolvedValue([]) }
      })
    );
  });

  it('books a partial move as a zero-PnL sell/buy pair at the source average cost', async () => {
    const service = createService({ totalAmount: 0.03, avgCost: 50_000 });

    const result = await service.transferCoin(SOURCE, 'BTC', TARGET, 0.01);

    expect(result).toEqual({ coinId: 'BTC', moved: 2, amount: 0.01 });

    const [{ data }] = prismaMock.coinTransaction.createMany.mock.calls[0];
    const [sell, buy] = data;

    expect(sell.portfolioId).toBe(SOURCE);
    expect(sell.type).toBe('sell');
    expect(buy.portfolioId).toBe(TARGET);
    expect(buy.type).toBe('buy');

    for (const row of [sell, buy]) {
      expect(Number(row.amount)).toBeCloseTo(0.01, 10);
      // Priced at avgCost, so the sell realizes exactly nothing.
      expect(Number(row.price)).toBe(50_000);
      expect(Number(row.totalValue)).toBeCloseTo(500, 8);
      expect(row.note).toMatch(/^\[transfer]/);
    }

    // A partial move must not touch the existing history.
    expect(prismaMock.coinTransaction.updateMany).not.toHaveBeenCalled();
  });

  it('moves the whole transaction history when the amount covers the full holding', async () => {
    const service = createService({ totalAmount: 0.03, avgCost: 50_000 });
    prismaMock.coinTransaction.findMany.mockResolvedValue([{ id: 'tx-1' }, { id: 'tx-2' }]);

    const result = await service.transferCoin(SOURCE, 'BTC', TARGET, 0.03);

    expect(result).toEqual({ coinId: 'BTC', moved: 2 });
    expect(prismaMock.coinTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['tx-1', 'tx-2'] } },
      data: { portfolioId: TARGET }
    });
    expect(prismaMock.coinTransaction.createMany).not.toHaveBeenCalled();
  });

  it('rejects an amount larger than the holding', async () => {
    const service = createService({ totalAmount: 0.03, avgCost: 50_000 });

    await expect(service.transferCoin(SOURCE, 'BTC', TARGET, 0.05)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prismaMock.coinTransaction.createMany).not.toHaveBeenCalled();
    expect(prismaMock.coinTransaction.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a quantity transfer when the coin is not held in the source', async () => {
    const service = createService(null);

    await expect(service.transferCoin(SOURCE, 'BTC', TARGET, 0.01)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('still rejects a transfer into the same portfolio', async () => {
    const service = createService({ totalAmount: 0.03, avgCost: 50_000 });

    await expect(service.transferCoin(SOURCE, 'BTC', SOURCE, 0.01)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
