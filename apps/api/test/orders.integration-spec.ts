import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { OrdersController } from '../src/modules/orders/orders.controller';

describe('orders integration flow', () => {
  it('creates then closes an order end to end through the controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const controller = moduleRef.get(OrdersController);

    const createdOrder = (await controller.createOrder({
      symbol: 'BTCUSDT',
      side: 'long',
      entryPrice: 68000,
      quantity: 2
    })) as {
      id?: string;
      symbol: string;
      status: string;
      entryPrice: number;
      quantity: number;
    };

    expect(createdOrder).toMatchObject({
      symbol: 'BTCUSDT',
      status: 'open',
      entryPrice: 68000,
      quantity: 2
    });

    const closedOrder = (await controller.closeOrder('order-integration-1', {
      closePrice: 69000
    })) as {
      id: string;
      status: string;
      closePrice: number;
      pnl: number;
    };

    expect(closedOrder).toMatchObject({
      id: 'order-integration-1',
      status: 'closed',
      closePrice: 69000,
      pnl: 2000
    });
  });
});
