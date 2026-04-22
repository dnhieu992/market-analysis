import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import { prisma } from '@app/db';
import { COMPOUND_HOLDING_REPOSITORY } from '../database/database.providers';

type CompoundHoldingRepository = ReturnType<typeof import('@app/db').createCompoundHoldingRepository>;

export type CompoundHoldingWithPnl = {
  id: string;
  compoundPortfolioId: string;
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
export class CompoundHoldingsService {
  constructor(
    @Inject(COMPOUND_HOLDING_REPOSITORY)
    private readonly holdingRepository: CompoundHoldingRepository
  ) {}

  async getByPortfolio(compoundPortfolioId: string, currentPrices: Record<string, number> = {}): Promise<CompoundHoldingWithPnl[]> {
    const holdings = await this.holdingRepository.listByPortfolio(compoundPortfolioId);

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
    compoundPortfolioId: string,
    coinId: string,
    amount: number,
    totalValue: number
  ): Promise<void> {
    const existing = await this.holdingRepository.findByPortfolioAndCoin(compoundPortfolioId, coinId);

    if (!existing) {
      await this.holdingRepository.upsert(compoundPortfolioId, coinId, {
        id: randomUUID(),
        compoundPortfolioId,
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

    await this.holdingRepository.update(compoundPortfolioId, coinId, {
      totalAmount: new Decimal(newTotalAmount),
      totalCost: new Decimal(newTotalCost),
      avgCost: new Decimal(newAvgCost)
    });
  }

  async updateOnSell(
    compoundPortfolioId: string,
    coinId: string,
    amount: number,
    price: number
  ): Promise<void> {
    const existing = await this.holdingRepository.findByPortfolioAndCoin(compoundPortfolioId, coinId);

    if (!existing) return;

    const avgCost = Number(existing.avgCost);
    const newRealizedPnl = Number(existing.realizedPnl) + (price - avgCost) * amount;
    const newTotalAmount = Number(existing.totalAmount) - amount;
    const newTotalCost = Number(existing.totalCost) - avgCost * amount;

    await this.holdingRepository.update(compoundPortfolioId, coinId, {
      totalAmount: new Decimal(newTotalAmount),
      totalCost: new Decimal(newTotalCost),
      realizedPnl: new Decimal(newRealizedPnl)
    });
  }

  async recalculate(compoundPortfolioId: string, coinId?: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      if (coinId) {
        await tx.compoundHolding.deleteMany({ where: { compoundPortfolioId, coinId } });

        const transactions = await tx.compoundTransaction.findMany({
          where: { compoundPortfolioId, coinId, deletedAt: null },
          orderBy: { transactedAt: 'asc' }
        });

        await this.replayTransactions(tx, compoundPortfolioId, coinId, transactions);
      } else {
        await tx.compoundHolding.deleteMany({ where: { compoundPortfolioId } });

        const transactions = await tx.compoundTransaction.findMany({
          where: { compoundPortfolioId, deletedAt: null },
          orderBy: { transactedAt: 'asc' }
        });

        const byCoin = groupByCoin(transactions);

        for (const [coin, txs] of Object.entries(byCoin)) {
          await this.replayTransactions(tx, compoundPortfolioId, coin, txs);
        }
      }
    });
  }

  private async replayTransactions(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    compoundPortfolioId: string,
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
      await tx.compoundHolding.upsert({
        where: { compoundPortfolioId_coinId: { compoundPortfolioId, coinId } },
        create: {
          id: randomUUID(),
          compoundPortfolioId,
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
