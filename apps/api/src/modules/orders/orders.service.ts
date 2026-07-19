import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createOrderJournalRepository } from '@app/db';

import { ORDER_REPOSITORY } from '../database/database.providers';
import type { CloseOrderDto } from './dto/close-order.dto';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';

/** Compact number for log content — trims trailing zeros, keeps small prices readable. */
function fmtNum(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return Number(n.toFixed(digits)).toString();
}

type OrderRepository = {
  create: (data: Record<string, unknown>) => Promise<unknown>;
  findById: (id: string) => Promise<unknown | null>;
  listLatest: (limit?: number) => Promise<unknown[]>;
  listFiltered: (params: {
    symbol?: string;
    status?: 'open' | 'closed';
    brokers?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    page: number;
    pageSize: number;
  }) => Promise<{
    data: unknown[];
    total: number;
    closedPnlSum: number;
    openOrders: unknown[];
  }>;
  listDistinctBrokers: () => Promise<string[]>;
  update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly journalRepo = createOrderJournalRepository();

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository
  ) {}

  /** Append a read-only lifecycle log to an order's journal. Never throws — a
   *  failed log must not break creating/closing a trade. */
  private async writeSystemLog(
    orderId: string,
    content: string,
    snapshot: { price?: number; entryPrice?: number; pnlUsd?: number }
  ): Promise<void> {
    try {
      await this.journalRepo.create({ orderId, kind: 'system', content, snapshot });
    } catch (err) {
      this.logger.warn(`Failed to write journal log for order ${orderId}: ${(err as Error).message}`);
    }
  }

  async listOrders(query: ListOrdersQueryDto) {
    const brokers = query.broker
      ? query.broker.split(',').map((b) => b.trim()).filter(Boolean)
      : undefined;

    const result = await this.orderRepository.listFiltered({
      symbol: query.symbol,
      status: query.status,
      brokers,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      page: query.page,
      pageSize: query.pageSize,
    });

    return { ...result, page: query.page, pageSize: query.pageSize };
  }

  listBrokers() {
    return this.orderRepository.listDistinctBrokers();
  }

  async getOrderById(id: string) {
    const order = await this.orderRepository.findById(id);

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    return order;
  }

  async createOrder(input: CreateOrderDto) {
    const order = await this.orderRepository.create({
      ...input,
      source: 'manual',
      status: 'open',
      openedAt: input.openedAt ? new Date(input.openedAt) : new Date()
    });

    const o = order as { id: string; symbol: string; side: string; entryPrice?: number; quantity?: number };
    const side = o.side === 'short' ? 'SHORT' : 'LONG';
    const content = [
      `🟢 **Đã mở lệnh** ${side} ${o.symbol}`,
      `- Giá vào: ${fmtNum(o.entryPrice)}`,
      ...(o.quantity != null ? [`- Size: ${fmtNum(o.quantity)}`] : []),
    ].join('\n');
    await this.writeSystemLog(o.id, content, { price: o.entryPrice, entryPrice: o.entryPrice });

    return order;
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
      symbol?: string;
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

    const updated = await this.orderRepository.update(id, {
      status: 'closed',
      closePrice: input.closePrice,
      closedAt: input.closedAt ? new Date(input.closedAt) : new Date(),
      note: input.note,
      pnl
    });

    const side = existingOrder.side === 'short' ? 'SHORT' : 'LONG';
    const sign = pnl >= 0 ? '+' : '−';
    const content = [
      `🔴 **Đã đóng lệnh** ${side} ${existingOrder.symbol ?? ''}`.trim(),
      `- Giá đóng: ${fmtNum(input.closePrice)}`,
      `- PnL: ${sign}${fmtNum(Math.abs(pnl))} USDT`,
    ].join('\n');
    await this.writeSystemLog(id, content, { price: input.closePrice, entryPrice, pnlUsd: pnl });

    return updated;
  }
}
