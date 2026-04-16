import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import { prisma } from '@app/db';
import { PNL_HISTORY_REPOSITORY } from '../database/database.providers';
import { MarketDataService } from '../market/market-data.service';
import type { QueryPnlDto } from './dto/query-pnl.dto';

type PnlHistoryRepository = ReturnType<typeof import('@app/db').createPnlHistoryRepository>;

@Injectable()
export class PnlService {
  private readonly logger = new Logger(PnlService.name);

  constructor(
    @Inject(PNL_HISTORY_REPOSITORY)
    private readonly pnlHistoryRepository: PnlHistoryRepository,
    private readonly marketDataService: MarketDataService
  ) {}

  getPnlHistory(portfolioId: string, query: QueryPnlDto) {
    return this.pnlHistoryRepository.listByPortfolio(portfolioId, {
      coinId: query.coinId ?? undefined,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined
    });
  }

  @Cron('0 23 * * *')
  async snapshotDaily() {
    this.logger.log('Running daily PnL snapshot...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      const portfolios = await prisma.portfolio.findMany({
        include: { holdings: true }
      });

      for (const portfolio of portfolios) {
        if (portfolio.holdings.length === 0) continue;

        const activeCoinIds = portfolio.holdings
          .filter((h) => Number(h.totalAmount) > 0)
          .map((h) => h.coinId);

        const priceMap = await this.fetchCurrentPrices(activeCoinIds);

        let totalRealizedPnl = 0;
        let totalUnrealizedPnl = 0;
        let totalValue = 0;

        for (const holding of portfolio.holdings) {
          const price = priceMap[holding.coinId];
          if (price == null) continue;

          const totalAmount = Number(holding.totalAmount);
          const avgCost = Number(holding.avgCost);
          const realizedPnl = Number(holding.realizedPnl);
          const unrealizedPnl = (price - avgCost) * totalAmount;
          const coinValue = price * totalAmount;

          totalRealizedPnl += realizedPnl;
          totalUnrealizedPnl += unrealizedPnl;
          totalValue += coinValue;

          await this.pnlHistoryRepository.upsertSnapshot({
            id: randomUUID(),
            portfolioId: portfolio.id,
            coinId: holding.coinId,
            date: today,
            realizedPnl: new Decimal(realizedPnl),
            unrealizedPnl: new Decimal(unrealizedPnl),
            totalValue: new Decimal(coinValue)
          });
        }

        // Portfolio-level aggregate snapshot (coinId = null)
        await this.pnlHistoryRepository.upsertSnapshot({
          id: randomUUID(),
          portfolioId: portfolio.id,
          coinId: null,
          date: today,
          realizedPnl: new Decimal(totalRealizedPnl),
          unrealizedPnl: new Decimal(totalUnrealizedPnl),
          totalValue: new Decimal(totalValue)
        });
      }

      this.logger.log('Daily PnL snapshot completed');
    } catch (error) {
      this.logger.error('Daily PnL snapshot failed', error);
    }
  }

  private async fetchCurrentPrices(coinIds: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};

    for (const coinId of coinIds) {
      try {
        const symbol = `${coinId}USDT`;
        const candles = await this.marketDataService.getCandles(symbol, '1h', 1);

        if (candles.length > 0) {
          prices[coinId] = candles[candles.length - 1]!.close;
        }
      } catch {
        this.logger.warn(`Failed to fetch price for ${coinId}`);
      }
    }

    return prices;
  }
}
