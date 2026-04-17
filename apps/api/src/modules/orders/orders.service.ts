import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ORDER_REPOSITORY } from '../database/database.providers';
import type { CloseOrderDto } from './dto/close-order.dto';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';

type OrderRepository = {
  create: (data: Record<string, unknown>) => Promise<unknown>;
  findById: (id: string) => Promise<unknown | null>;
  listLatest: (limit?: number) => Promise<unknown[]>;
  update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
};

@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository
  ) {}

  listOrders() {
    return this.orderRepository.listLatest(50);
  }

  async getOrderById(id: string) {
    const order = await this.orderRepository.findById(id);

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    return order;
  }

  createOrder(input: CreateOrderDto) {
    return this.orderRepository.create({
      ...input,
      source: 'manual',
      status: 'open',
      openedAt: input.openedAt ? new Date(input.openedAt) : new Date()
    });
  }

  async updateOrder(id: string, input: UpdateOrderDto) {
    const existingOrder = (await this.getOrderById(id)) as {
      status?: string;
      entryPrice?: number;
      closePrice?: number;
      quantity?: number;
      side?: 'long' | 'short';
    };

    const updateData: Record<string, unknown> = {
      ...input,
      ...(input.openedAt ? { openedAt: new Date(input.openedAt) } : {})
    };

    // Recalculate PnL if the order is closed and price/quantity fields changed
    if (existingOrder.status === 'closed') {
      const entryPrice = input.entryPrice ?? existingOrder.entryPrice ?? 0;
      const closePrice = input.closePrice ?? existingOrder.closePrice ?? 0;
      const quantity = input.quantity ?? existingOrder.quantity ?? 1;
      const side = input.side ?? existingOrder.side;

      updateData.pnl =
        side === 'short'
          ? (entryPrice - closePrice) * quantity
          : (closePrice - entryPrice) * quantity;
    }

    return this.orderRepository.update(id, updateData);
  }

  async removeOrder(id: string) {
    await this.getOrderById(id);
    return this.orderRepository.remove(id);
  }

  async closeOrder(id: string, input: CloseOrderDto) {
    const existingOrder = (await this.getOrderById(id)) as {
      entryPrice?: number;
      quantity?: number;
      side?: 'long' | 'short';
    };
    const quantity = existingOrder.quantity ?? 1;
    const entryPrice = existingOrder.entryPrice ?? 0;
    const pnl =
      existingOrder.side === 'short'
        ? (entryPrice - input.closePrice) * quantity
        : (input.closePrice - entryPrice) * quantity;

    return this.orderRepository.update(id, {
      status: 'closed',
      closePrice: input.closePrice,
      closedAt: input.closedAt ? new Date(input.closedAt) : new Date(),
      note: input.note,
      pnl
    });
  }
}
