import { Decimal } from '@prisma/client/runtime/library';
import { DcaService } from '../src/modules/dca/dca.service';

describe('DcaService.createConfig', () => {
  let service: DcaService;
  let dcaConfigRepo: { create: jest.Mock };
  let portfolioService: { getPortfolio: jest.Mock; createPortfolio: jest.Mock };

  beforeEach(() => {
    dcaConfigRepo = { create: jest.fn() };
    portfolioService = {
      getPortfolio: jest.fn(),
      createPortfolio: jest.fn()
    };
    service = new DcaService(
      dcaConfigRepo as never,
      {} as never,
      {} as never,
      portfolioService as never
    );
  });

  it('creates config with existing portfolioId', async () => {
    portfolioService.getPortfolio.mockResolvedValue({ id: 'p-1', name: 'Portfolio' });
    dcaConfigRepo.create.mockResolvedValue({ id: 'c-1', coin: 'BTC', portfolioId: 'p-1' });

    const result = await service.createConfig('u-1', { coin: 'BTC', totalBudget: 1000, portfolioId: 'p-1' });

    expect(portfolioService.getPortfolio).toHaveBeenCalledWith('p-1', 'u-1');
    expect(result).toMatchObject({ portfolioId: 'p-1' });
  });

  it('auto-creates portfolio when portfolioName is provided', async () => {
    portfolioService.createPortfolio.mockResolvedValue({ id: 'p-new', name: 'My DCA' });
    dcaConfigRepo.create.mockResolvedValue({ id: 'c-1', coin: 'BTC', portfolioId: 'p-new' });

    const result = await service.createConfig('u-1', { coin: 'BTC', totalBudget: 1000, portfolioName: 'My DCA' });

    expect(portfolioService.createPortfolio).toHaveBeenCalledWith('u-1', { name: 'My DCA' });
    expect(result).toMatchObject({ portfolioId: 'p-new' });
  });

  it('throws when neither portfolioId nor portfolioName provided', async () => {
    await expect(
      service.createConfig('u-1', { coin: 'BTC', totalBudget: 1000 } as never)
    ).rejects.toThrow('Either portfolioId or portfolioName is required');
  });

  it('throws when both portfolioId and portfolioName are provided', async () => {
    await expect(
      service.createConfig('u-1', {
        coin: 'BTC',
        totalBudget: 1000,
        portfolioId: 'p-1',
        portfolioName: 'My DCA'
      })
    ).rejects.toThrow('Provide either portfolioId or portfolioName, not both');
  });

  it('allows two configs for the same coin (no duplicate check)', async () => {
    portfolioService.getPortfolio.mockResolvedValue({ id: 'p-2', name: 'Portfolio 2' });
    dcaConfigRepo.create.mockResolvedValue({ id: 'c-2', coin: 'BTC', portfolioId: 'p-2' });

    const result = await service.createConfig('u-1', { coin: 'BTC', totalBudget: 2000, portfolioId: 'p-2' });

    expect(result).toMatchObject({ id: 'c-2' });
  });
});

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
