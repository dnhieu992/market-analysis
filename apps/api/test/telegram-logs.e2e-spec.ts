import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { TelegramLogsController } from '../src/modules/telegram-logs/telegram-logs.controller';
import { TelegramLogsService } from '../src/modules/telegram-logs/telegram-logs.service';

describe('telegram logs module', () => {
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

  it('lists telegram logs', async () => {
    const service = app.get(TelegramLogsService);
    const controller = app.get(TelegramLogsController);

    jest.spyOn(service, 'listTelegramLogs').mockResolvedValue([
      {
        id: 'log-1',
        messageType: 'analysis',
        success: true
      }
    ]);

    await expect(controller.listTelegramLogs()).resolves.toHaveLength(1);
  });
});
