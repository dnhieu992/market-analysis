import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { WorkerController } from '../src/modules/worker/worker.controller';
import { WorkerModule } from '../src/modules/worker/worker.module';
import { WorkerService } from '../src/modules/worker/worker.service';

describe('worker trigger module', () => {
  it('is disabled by default', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule]
    }).compile();

    const controller = moduleRef.get(WorkerController);

    await expect(controller.runAnalysis({})).rejects.toThrow(ForbiddenException);
  });

  it('can be enabled and uses configured symbols when no override is provided', async () => {
    const service = new WorkerService(
      {
        enabled: true,
        trackedSymbols: ['BTCUSDT', 'ETHUSDT']
      },
      async (symbols: string[]) => ({
        status: 'queued',
        scheduled: symbols
      })
    );

    await expect(service.runAnalysis({})).resolves.toEqual({
      status: 'queued',
      scheduled: ['BTCUSDT', 'ETHUSDT']
    });
  });

  it('accepts a single symbol override', async () => {
    const service = new WorkerService(
      {
        enabled: true,
        trackedSymbols: ['BTCUSDT', 'ETHUSDT']
      },
      async (symbols: string[]) => ({
        status: 'queued',
        scheduled: symbols
      })
    );

    await expect(service.runAnalysis({ symbol: 'SOLUSDT' })).resolves.toEqual({
      status: 'queued',
      scheduled: ['SOLUSDT']
    });
  });
});
