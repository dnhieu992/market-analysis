import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { DailyAnalysisController } from '../src/modules/daily-analysis/daily-analysis.controller';
import { DailyAnalysisService } from '../src/modules/daily-analysis/daily-analysis.service';

describe('daily-analysis module', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists daily analysis records for a symbol', async () => {
    const service = app.get(DailyAnalysisService);
    const controller = app.get(DailyAnalysisController);

    jest.spyOn(service, 'list').mockResolvedValue([
      {
        id: 'daily-1',
        symbol: 'BTCUSDT',
        date: new Date('2026-04-05'),
        d1Trend: 'bullish',
        h4Trend: 'bearish',
        d1S1: 81000,
        d1S2: 78500,
        d1R1: 85200,
        d1R2: 88500,
        h4S1: 82000,
        h4S2: 80400,
        h4R1: 83200,
        h4R2: 84100,
        summary: '📅 BTC Daily Plan',
        createdAt: new Date()
      }
    ]);

    await expect(controller.list({ symbol: 'BTCUSDT' })).resolves.toHaveLength(1);
  });

  it('returns latest daily analysis for a symbol', async () => {
    const service = app.get(DailyAnalysisService);
    const controller = app.get(DailyAnalysisController);

    jest.spyOn(service, 'getLatest').mockResolvedValue({
      id: 'daily-1',
      symbol: 'BTCUSDT',
      date: new Date('2026-04-05'),
      d1Trend: 'bullish',
      h4Trend: 'neutral',
      d1S1: 81000,
      d1S2: 78500,
      d1R1: 85200,
      d1R2: 88500,
      h4S1: 82000,
      h4S2: 80400,
      h4R1: 83200,
      h4R2: 84100,
      summary: '📅 BTC Daily Plan',
      createdAt: new Date()
    });

    await expect(controller.getLatest('BTCUSDT')).resolves.toMatchObject({ symbol: 'BTCUSDT' });
  });
});
