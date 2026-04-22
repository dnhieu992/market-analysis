import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { COMPOUND_TRADE_REPOSITORY } from '../database/database.providers';
import type { CreateCompoundTradeDto } from './dto/create-compound-trade.dto';
import type { QueryCompoundTradesDto } from './dto/query-compound-trades.dto';
import type { UpdateCompoundTradeDto } from './dto/update-compound-trade.dto';

type CompoundTradeRepository = ReturnType<typeof import('@app/db').createCompoundTradeRepository>;

@Injectable()
export class CompoundTradeService {
  constructor(
    @Inject(COMPOUND_TRADE_REPOSITORY)
    private readonly repository: CompoundTradeRepository
  ) {}

  listTrades(userId: string, query: QueryCompoundTradesDto) {
    return this.repository.listByUser(userId, {
      coinId: query.coinId,
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined
    });
  }

  async getTrade(id: string, userId: string) {
    const trade = await this.repository.findById(id);
    if (!trade) throw new NotFoundException(`Compound trade ${id} not found`);
    if (trade.userId !== userId) throw new ForbiddenException('Access denied');
    return trade;
  }

  createTrade(userId: string, input: CreateCompoundTradeDto) {
    const amount = Number(input.amount);
    const price = Number(input.price);
    return this.repository.create({
      id: randomUUID(),
      userId,
      coinId: input.coinId.toUpperCase(),
      type: input.type,
      amount,
      price,
      totalValue: amount * price,
      fee: input.fee ?? 0,
      note: input.note ?? null,
      tradedAt: input.tradedAt ? new Date(input.tradedAt) : new Date()
    });
  }

  async updateTrade(id: string, userId: string, input: UpdateCompoundTradeDto) {
    const existing = await this.getTrade(id, userId);
    const amount = input.amount != null ? Number(input.amount) : Number(existing.amount);
    const price = input.price != null ? Number(input.price) : Number(existing.price);
    return this.repository.update(id, {
      ...(input.coinId ? { coinId: input.coinId.toUpperCase() } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.amount != null ? { amount } : {}),
      ...(input.price != null ? { price } : {}),
      totalValue: amount * price,
      ...(input.fee != null ? { fee: input.fee } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.tradedAt ? { tradedAt: new Date(input.tradedAt) } : {})
    });
  }

  async removeTrade(id: string, userId: string) {
    await this.getTrade(id, userId);
    return this.repository.remove(id);
  }
}
