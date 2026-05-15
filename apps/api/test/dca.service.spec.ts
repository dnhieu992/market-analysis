import { Decimal } from '@prisma/client/runtime/library';
import { DcaService } from '../src/modules/dca/dca.service';

describe('DcaService.getCapitalState', () => {
  let service: DcaService;
  let txRepo: { listByPortfolio: jest.Mock };
  let holdingRepo: { findByPortfolioAndCoin: jest.Mock };

  beforeEach(() => {
    txRepo = { listByPortfolio: jest.fn() };
    holdingRepo = { findByPortfolioAndCoin: jest.fn() };
    service = new DcaService(
      {} as never,
      txRepo as never,
      holdingRepo as never,
      {} as never
    );
  });

  const config = {
    portfolioId: 'p1',
    coin: 'BTC',
    totalBudget: new Decimal(10000)
  };

  it('deployedAmount equals total buys, not net of sells', async () => {
    txRepo.listByPortfolio.mockResolvedValue([
      { type: 'buy', totalValue: new Decimal(3000) },
      { type: 'buy', totalValue: new Decimal(2000) },
      { type: 'sell', totalValue: new Decimal(1000) }
    ]);
    holdingRepo.findByPortfolioAndCoin.mockResolvedValue(null);

    const result = await service.getCapitalState(config);

    expect(result.deployedAmount).toBe(5000);
    expect(result.remaining).toBe(5000);
  });

  it('remaining is budget minus buys regardless of sell proceeds', async () => {
    txRepo.listByPortfolio.mockResolvedValue([
      { type: 'buy', totalValue: new Decimal(8000) },
      { type: 'sell', totalValue: new Decimal(4000) }
    ]);
    holdingRepo.findByPortfolioAndCoin.mockResolvedValue(null);

    const result = await service.getCapitalState(config);

    // 10000 - 8000 = 2000, NOT 10000 - (8000-4000) = 6000
    expect(result.remaining).toBe(2000);
  });

  it('runner amounts come from holding record', async () => {
    txRepo.listByPortfolio.mockResolvedValue([]);
    holdingRepo.findByPortfolioAndCoin.mockResolvedValue({
      totalAmount: new Decimal('0.05'),
      avgCost: new Decimal(80000)
    });

    const result = await service.getCapitalState(config);

    expect(result.runnerAmount).toBe(0.05);
    expect(result.runnerAvgCost).toBe(80000);
  });
});
