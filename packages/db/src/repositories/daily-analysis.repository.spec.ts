import { createDailyAnalysisRepository } from './daily-analysis.repository';

describe('daily analysis repository', () => {
  it('passes structured llm fields through create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'daily-1' });
    const repository = createDailyAnalysisRepository({
      dailyAnalysis: {
        create,
        findUnique: jest.fn(),
        findMany: jest.fn()
      }
    } as never);

    await repository.create({
      symbol: 'BTCUSDT',
      date: new Date('2026-04-07'),
      d1Trend: 'bullish',
      h4Trend: 'neutral',
      d1S1: 81000,
      d1S2: 79000,
      d1R1: 85000,
      d1R2: 87000,
      h4S1: 82000,
      h4S2: 80500,
      h4R1: 84200,
      h4R2: 85500,
      summary: 'BTC daily plan',
      llmProvider: 'claude',
      llmModel: 'sonnet',
      aiOutputJson: '{"analysis":"..."}'
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        llmProvider: 'claude',
        llmModel: 'sonnet',
        aiOutputJson: '{"analysis":"..."}'
      })
    });
  });

  it('returns structured llm fields from listLatest', async () => {
    const row = {
      id: 'daily-1',
      symbol: 'BTCUSDT',
      date: new Date('2026-04-07'),
      d1Trend: 'bullish',
      h4Trend: 'neutral',
      d1S1: 81000,
      d1S2: 79000,
      d1R1: 85000,
      d1R2: 87000,
      h4S1: 82000,
      h4S2: 80500,
      h4R1: 84200,
      h4R2: 85500,
      summary: 'BTC daily plan',
      llmProvider: 'claude',
      llmModel: 'sonnet',
      aiOutputJson: '{"analysis":"..."}',
      createdAt: new Date('2026-04-07T01:00:00.000Z')
    };
    const findMany = jest.fn().mockResolvedValue([row]);
    const repository = createDailyAnalysisRepository({
      dailyAnalysis: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany
      }
    } as never);

    await expect(repository.listLatest('BTCUSDT', 1)).resolves.toEqual([row]);
    expect(findMany).toHaveBeenCalledWith({
      where: { symbol: 'BTCUSDT' },
      orderBy: { date: 'desc' },
      take: 1
    });
  });
});
