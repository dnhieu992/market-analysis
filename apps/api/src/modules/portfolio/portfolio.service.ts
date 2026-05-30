import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { prisma } from '@app/db';
import { PORTFOLIO_REPOSITORY } from '../database/database.providers';
import type { CreatePortfolioDto } from './dto/create-portfolio.dto';
import type { UpdatePortfolioDto } from './dto/update-portfolio.dto';

type PortfolioRepository = ReturnType<typeof import('@app/db').createPortfolioRepository>;

export type PortfolioPnlCalendar = {
  daily: { date: string; realizedPnl: number }[];
  byCoin: { coinId: string; realizedPnl: number }[];
};

@Injectable()
export class PortfolioService {
  constructor(
    @Inject(PORTFOLIO_REPOSITORY)
    private readonly portfolioRepository: PortfolioRepository
  ) {}

  listPortfolios(userId: string) {
    return this.portfolioRepository.listByUserId(userId);
  }

  async getPortfolio(id: string, userId: string) {
    const portfolio = await this.portfolioRepository.findById(id);

    if (!portfolio) {
      throw new NotFoundException(`Portfolio ${id} not found`);
    }

    if (portfolio.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return portfolio;
  }

  createPortfolio(userId: string, input: CreatePortfolioDto) {
    return this.portfolioRepository.create({
      id: randomUUID(),
      userId,
      name: input.name,
      description: input.description
    });
  }

  async updatePortfolio(id: string, userId: string, input: UpdatePortfolioDto) {
    await this.getPortfolio(id, userId);
    return this.portfolioRepository.update(id, input);
  }

  async removePortfolio(id: string, userId: string) {
    await this.getPortfolio(id, userId);
    return this.portfolioRepository.remove(id);
  }

  async getPnlCalendar(userId: string): Promise<PortfolioPnlCalendar> {
    const portfolios = await prisma.portfolio.findMany({ where: { userId } });

    const pnlByDate = new Map<string, number>();
    const pnlByCoin = new Map<string, number>();

    for (const portfolio of portfolios) {
      const transactions = await prisma.coinTransaction.findMany({
        where: { portfolioId: portfolio.id, deletedAt: null },
        orderBy: { transactedAt: 'asc' }
      });

      // Group by coin then replay to get realized PnL per sell
      const byCoin: Record<string, typeof transactions> = {};
      for (const tx of transactions) {
        if (!byCoin[tx.coinId]) byCoin[tx.coinId] = [];
        byCoin[tx.coinId]!.push(tx);
      }

      for (const [coinId, txs] of Object.entries(byCoin)) {
        let totalAmount = 0;
        let totalCost = 0;
        let avgCost = 0;

        for (const tx of txs) {
          const amount = Number(tx.amount);
          const price = Number(tx.price);
          const totalValue = Number(tx.totalValue);

          if (tx.type === 'buy') {
            totalAmount += amount;
            totalCost += totalValue;
            avgCost = totalAmount > 0 ? totalCost / totalAmount : 0;
          } else {
            const realizedPnl = (price - avgCost) * amount;
            const dateKey = tx.transactedAt.toISOString().slice(0, 10);
            pnlByDate.set(dateKey, (pnlByDate.get(dateKey) ?? 0) + realizedPnl);
            pnlByCoin.set(coinId, (pnlByCoin.get(coinId) ?? 0) + realizedPnl);
            totalAmount -= amount;
            totalCost -= avgCost * amount;
          }
        }
      }
    }

    return {
      daily: Array.from(pnlByDate.entries())
        .map(([date, realizedPnl]) => ({ date, realizedPnl }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byCoin: Array.from(pnlByCoin.entries())
        .map(([coinId, realizedPnl]) => ({ coinId, realizedPnl }))
        .sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl))
    };
  }
}
