import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { SignalsController } from '../src/modules/signals/signals.controller';
import { SignalsService } from '../src/modules/signals/signals.service';

describe('signals module', () => {
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

  it('returns latest signals', async () => {
    const service = app.get(SignalsService);
    const controller = app.get(SignalsController);

    jest.spyOn(service, 'listSignals').mockResolvedValue([
      {
        id: 'signal-1',
        symbol: 'BTCUSDT',
        timeframe: '4h',
        bias: 'bullish'
      }
    ]);

    await expect(controller.listSignals({})).resolves.toHaveLength(1);
  });

  it('returns latest signal by symbol and timeframe', async () => {
    const service = app.get(SignalsService);
    const controller = app.get(SignalsController);

    jest.spyOn(service, 'getLatestSignal').mockResolvedValue({
      id: 'signal-latest',
      symbol: 'BTCUSDT',
      timeframe: '4h'
    });

    await expect(controller.getLatestSignal('BTCUSDT', '4h')).resolves.toMatchObject({
      id: 'signal-latest'
    });
  });
});
