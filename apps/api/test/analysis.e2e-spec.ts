import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { AnalysisService } from '../src/modules/analysis/analysis.service';
import { AnalysisController } from '../src/modules/analysis/analysis.controller';

describe('analysis module', () => {
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

  it('returns latest analysis runs', async () => {
    const service = app.get(AnalysisService);
    const controller = app.get(AnalysisController);

    jest.spyOn(service, 'listAnalysisRuns').mockResolvedValue([
      {
        id: 'run-1',
        symbol: 'BTCUSDT',
        timeframe: '4h',
        candleCloseTime: new Date('2026-04-01T08:00:00.000Z')
      }
    ]);

    await expect(controller.listAnalysisRuns({})).resolves.toHaveLength(1);
  });

  it('returns the latest analysis for a symbol and timeframe', async () => {
    const service = app.get(AnalysisService);
    const controller = app.get(AnalysisController);

    jest.spyOn(service, 'getLatestAnalysisRun').mockResolvedValue({
      id: 'run-latest',
      symbol: 'BTCUSDT',
      timeframe: '4h'
    });

    await expect(controller.getLatestAnalysisRun('BTCUSDT', '4h')).resolves.toMatchObject({
      id: 'run-latest'
    });
  });
});
