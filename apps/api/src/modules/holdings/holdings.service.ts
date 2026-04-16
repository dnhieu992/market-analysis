import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import { prisma } from '@app/db';
import { HOLDING_REPOSITORY } from '../database/database.providers';

type HoldingRepository = ReturnType<typeof import('@app/db').createHoldingRepository>;

export type HoldingWithPnl = {
  id: string;
  portfolioId: string;
  coinId: string;
  totalAmount: Decimal;
  totalCost: Decimal;
  avgCost: Decimal;
  realizedPnl: Decimal;
  updatedAt: Date;
  unrealizedPnl: number | null;
  currentValue: number | null;
};

@Injectable()
export class HoldingsService {
  constructor(
    @Inject(HOLDING_REPOSITORY)
    private readonly holdingRepository: HoldingRepository
  ) {}

  async getByPortfolio(portfolioId: string, currentPrices: Record<string, number> = {}): Promise<HoldingWithPnl[]> {
    const holdings = await this.holdingRepository.listByPortfolio(portfolioId);

    return holdings.map((h) => {
      const price = currentPrices[h.coinId];
      const totalAmount = Number(h.totalAmount);
      const avgCost = Number(h.avgCost);

      const unrealizedPnl = price != null ? (price - avgCost) * totalAmount : null;
      const currentValue = price != null ? price * totalAmount : null;

      return { ...h, unrealizedPnl, currentValue };
    });
  }

  async updateOnBuy(
    portfolioId: string,
    coinId: string,
    amount: number,
    totalValue: number
  ): Promise<void> {
    const existing = await this.holdingRepository.findByPortfolioAndCoin(portfolioId, coinId);

    if (!existing) {
      await this.holdingRepository.upsert(portfolioId, coinId, {
        id: randomUUID(),
        portfolioId,
        coinId,
        totalAmount: new Decimal(amount),
        totalCost: new Decimal(totalValue),
        avgCost: new Decimal(totalValue / amount),
        realizedPnl: new Decimal(0)
      });
      return;
    }

    const newTotalAmount = Number(existing.totalAmount) + amount;
    const newTotalCost = Number(existing.totalCost) + totalValue;
    const newAvgCost = newTotalCost / newTotalAmount;

    await this.holdingRepository.update(portfolioId, coinId, {
      totalAmount: new Decimal(newTotalAmount),
      totalCost: new Decimal(newTotalCost),
      avgCost: new Decimal(newAvgCost)
    });
  }

  async updateOnSell(
    portfolioId: string,
    coinId: string,
    amount: number,
    price: number
  ): Promise<void> {
    const existing = await this.holdingRepository.findByPortfolioAndCoin(portfolioId, coinId);

    if (!existing) return;

    const avgCost = Number(existing.avgCost);
    const newRealizedPnl = Number(existing.realizedPnl) + (price - avgCost) * amount;
    const newTotalAmount = Number(existing.totalAmount) - amount;
    const newTotalCost = Number(existing.totalCost) - avgCost * amount;

    await this.holdingRepository.update(portfolioId, coinId, {
      totalAmount: new Decimal(newTotalAmount),
      totalCost: new Decimal(newTotalCost),
      realizedPnl: new Decimal(newRealizedPnl)
      // avgCost stays the same on sell
    });
  }

  async recalculate(portfolioId: string, coinId?: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      if (coinId) {
        await tx.holding.deleteMany({ where: { portfolioId, coinId } });

        const transactions = await tx.coinTransaction.findMany({
          where: { portfolioId, coinId, deletedAt: null },
          orderBy: { transactedAt: 'asc' }
        });

        await this.replayTransactions(tx, portfolioId, coinId, transactions);
      } else {
        await tx.holding.deleteMany({ where: { portfolioId } });

        const transactions = await tx.coinTransaction.findMany({
          where: { portfolioId, deletedAt: null },
          orderBy: { transactedAt: 'asc' }
        });

        const byCoin = groupByCoin(transactions);

        for (const [coin, txs] of Object.entries(byCoin)) {
          await this.replayTransactions(tx, portfolioId, coin, txs);
        }
      }
    });
  }

  private async replayTransactions(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    portfolioId: string,
    coinId: string,
    transactions: { type: string; amount: Decimal; totalValue: Decimal; price: Decimal }[]
  ): Promise<void> {
    let totalAmount = 0;
    let totalCost = 0;
    let avgCost = 0;
    let realizedPnl = 0;

    for (const t of transactions) {
      const amount = Number(t.amount);
      const totalValue = Number(t.totalValue);
      const price = Number(t.price);

      if (t.type === 'buy') {
        totalAmount += amount;
        totalCost += totalValue;
        avgCost = totalAmount > 0 ? totalCost / totalAmount : 0;
      } else {
        realizedPnl += (price - avgCost) * amount;
        totalCost -= avgCost * amount;
        totalAmount -= amount;
      }
    }

    if (transactions.length > 0) {
      await tx.holding.upsert({
        where: { portfolioId_coinId: { portfolioId, coinId } },
        create: {
          id: randomUUID(),
          portfolioId,
          coinId,
          totalAmount: new Decimal(totalAmount),
          totalCost: new Decimal(totalCost),
          avgCost: new Decimal(avgCost),
          realizedPnl: new Decimal(realizedPnl)
        },
        update: {
          totalAmount: new Decimal(totalAmount),
          totalCost: new Decimal(totalCost),
          avgCost: new Decimal(avgCost),
          realizedPnl: new Decimal(realizedPnl)
        }
      });
    }
  }
}

function groupByCoin<T extends { coinId: string }>(items: T[]): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    if (!result[item.coinId]) result[item.coinId] = [];
    result[item.coinId]!.push(item);
  }
  return result;
}
