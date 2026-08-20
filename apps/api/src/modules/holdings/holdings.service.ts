import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import { prisma } from '@app/db';
import { HOLDING_REPOSITORY } from '../database/database.providers';

type HoldingRepository = ReturnType<typeof import('@app/db').createHoldingRepository>;

/** Marks the sell/buy pair a partial transfer books, so the UI can exclude it from trade stats. */
export const TRANSFER_NOTE_PREFIX = '[transfer]';

/** Amounts are stored as Decimal(20,8); tolerate float error below the last stored digit. */
const AMOUNT_EPSILON = 1e-8;

export type HoldingWithPnl = {
  id: string;
  portfolioId: string;
  coinId: string;
  totalAmount: Decimal;
  totalCost: Decimal;
  avgCost: Decimal;
  realizedPnl: Decimal;
  note: string | null;
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

  async updateNote(portfolioId: string, coinId: string, note: string | null): Promise<void> {
    await this.holdingRepository.update(portfolioId, coinId, { note });
  }

  /** Raw holding row for a coin in a portfolio (cost basis, realized PnL); null if none. */
  getHolding(portfolioId: string, coinId: string) {
    return this.holdingRepository.findByPortfolioAndCoin(portfolioId, coinId);
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

  /**
   * Move a coin position from one portfolio to another.
   *
   * With no `amount` (or an amount covering the whole holding) this reassigns every
   * transaction of that coin — including soft-deleted rows — to the target portfolio,
   * so cost basis, realized PnL and full history are preserved.
   *
   * With a smaller `amount` the history cannot follow, so the move is booked as a pair
   * of transactions priced at the source's average cost: a sell out of the source and a
   * buy into the target. Priced at avgCost the sell realizes exactly zero PnL, and the
   * target inherits the same cost basis — the units change books without inventing a trade.
   *
   * Either way, if the target already holds the coin the positions merge on recalculation.
   */
  async transferCoin(
    sourcePortfolioId: string,
    coinId: string,
    targetPortfolioId: string,
    amount?: number
  ): Promise<{ coinId: string; moved: number; amount?: number }> {
    if (sourcePortfolioId === targetPortfolioId) {
      throw new BadRequestException('Source and target portfolios must be different');
    }

    if (amount != null) {
      const holding = await this.holdingRepository.findByPortfolioAndCoin(sourcePortfolioId, coinId);

      if (!holding) {
        throw new NotFoundException(`No ${coinId} holding found in the source portfolio`);
      }

      const available = Number(holding.totalAmount);

      if (amount <= 0) {
        throw new BadRequestException('Transfer amount must be greater than zero');
      }

      // Float math on an 8-decimal column: anything within a satoshi of the full
      // holding is a full transfer, not a partial one that leaves dust behind.
      if (amount < available - AMOUNT_EPSILON) {
        return this.transferPartial(sourcePortfolioId, coinId, targetPortfolioId, amount, Number(holding.avgCost));
      }

      if (amount > available + AMOUNT_EPSILON) {
        throw new BadRequestException(
          `Cannot transfer ${amount} ${coinId}: only ${available} available in the source portfolio`
        );
      }
    }

    const txs = await prisma.coinTransaction.findMany({
      where: { portfolioId: sourcePortfolioId, coinId },
      select: { id: true }
    });

    if (txs.length === 0) {
      throw new NotFoundException(`No ${coinId} transactions found in the source portfolio`);
    }

    const ids = txs.map((t) => t.id);

    await prisma.coinTransaction.updateMany({
      where: { id: { in: ids } },
      data: { portfolioId: targetPortfolioId }
    });

    await this.recalculate(sourcePortfolioId, coinId);
    await this.recalculate(targetPortfolioId, coinId);

    return { coinId, moved: ids.length };
  }

  /**
   * Book a partial move as a zero-PnL sell/buy pair at `avgCost`. Both rows carry the
   * `[transfer]` note prefix so the UI can tell them apart from real trades — the sold /
   * remaining ratio reads the prefix to keep a transfer out of its "sold" bucket.
   */
  private async transferPartial(
    sourcePortfolioId: string,
    coinId: string,
    targetPortfolioId: string,
    amount: number,
    avgCost: number
  ): Promise<{ coinId: string; moved: number; amount: number }> {
    const portfolios = await prisma.portfolio.findMany({
      where: { id: { in: [sourcePortfolioId, targetPortfolioId] } },
      select: { id: true, name: true }
    });
    const nameOf = (id: string) => portfolios.find((p) => p.id === id)?.name ?? 'another portfolio';

    const transactedAt = new Date();
    const price = new Decimal(avgCost);
    const totalValue = new Decimal(amount * avgCost);

    await prisma.coinTransaction.createMany({
      data: [
        {
          id: randomUUID(),
          portfolioId: sourcePortfolioId,
          coinId,
          type: 'sell',
          price,
          amount: new Decimal(amount),
          totalValue,
          fee: new Decimal(0),
          note: `${TRANSFER_NOTE_PREFIX} Moved to ${nameOf(targetPortfolioId)}`,
          transactedAt
        },
        {
          id: randomUUID(),
          portfolioId: targetPortfolioId,
          coinId,
          type: 'buy',
          price,
          amount: new Decimal(amount),
          totalValue,
          fee: new Decimal(0),
          note: `${TRANSFER_NOTE_PREFIX} Moved from ${nameOf(sourcePortfolioId)}`,
          transactedAt
        }
      ]
    });

    await this.recalculate(sourcePortfolioId, coinId);
    await this.recalculate(targetPortfolioId, coinId);

    return { coinId, moved: 2, amount };
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
