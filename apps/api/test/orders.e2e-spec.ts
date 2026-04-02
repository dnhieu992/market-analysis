import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { OrdersController } from '../src/modules/orders/orders.controller';
import { OrdersService } from '../src/modules/orders/orders.service';

describe('orders module', () => {
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

  it('creates a manual order', async () => {
    const service = app.get(OrdersService);
    const controller = app.get(OrdersController);

    jest.spyOn(service, 'createOrder').mockResolvedValue({
      id: 'order-1',
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'open'
    });

    await expect(
      controller.createOrder({
        symbol: 'BTCUSDT',
        side: 'long',
        entryPrice: 68000
      })
    ).resolves.toMatchObject({ id: 'order-1' });
  });

  it('closes an order', async () => {
    const service = app.get(OrdersService);
    const controller = app.get(OrdersController);

    jest.spyOn(service, 'closeOrder').mockResolvedValue({
      id: 'order-1',
      status: 'closed',
      closePrice: 69000
    });

    await expect(
      controller.closeOrder('order-1', {
        closePrice: 69000
      })
    ).resolves.toMatchObject({ status: 'closed' });
  });
});
