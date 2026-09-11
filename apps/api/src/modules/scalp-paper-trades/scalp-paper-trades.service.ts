import { Injectable, Logger } from '@nestjs/common';
import {
  computeScalpPnlUsd,
  computeScalpRMultiple,
  type ScalpDirection,
} from '@app/core';
import { createScalpPaperTradeRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';

const SYMBOL = 'BTCUSDT';

export type ScalpPaperTradeDto = {
  id: string;
  symbol: string;
  direction: ScalpDirection;
  status: string;
  entryPrice: number;
  initialStopLoss: number;
  stopLoss: number;
  takeProfit: number;
  riskUsd: number;
  quantity: number;
  rrPlanned: number;
  h1Trend: string;
  reasoning: string;
  /** Claude's latest commentary from a HOLD/ADJUST tick — null until the first one. */
  lastNote: string | null;
  model: string | null;
  openedAt: string;
  closedAt: string | null;
  exitPrice: number | null;
  pnlUsd: number | null;
  rMultiple: number | null;
  lastPrice: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  /** Live result while OPEN — always null once closed (use pnlUsd/rMultiple instead). */
  unrealizedPnlUsd: number | null;
  unrealizedR: number | null;
};

export type ScalpPaperTradeStats = {
  closedCount: number;
  wins: number;
  losses: number;
  closedEarly: number;
  winRate: number | null;
  totalPnlUsd: number;
  totalR: number;
};

export type ScalpPaperTradeBoard = {
  symbol: string;
  price: number | null;
  openTrade: ScalpPaperTradeDto | null;
  history: ScalpPaperTradeDto[];
  stats: ScalpPaperTradeStats;
};

type TradeRow = Awaited<ReturnType<ReturnType<typeof createScalpPaperTradeRepository>['list']>>[number];

@Injectable()
export class ScalpPaperTradesService {
  private readonly logger = new Logger(ScalpPaperTradesService.name);
  private readonly repository = createScalpPaperTradeRepository();

  constructor(private readonly marketDataService: MarketDataService) {}

  async getBoard(): Promise<ScalpPaperTradeBoard> {
    const rows = await this.repository.list();
    const price = await this.fetchPrice();

    const dtos = rows.map((row) => this.toDto(row, price));
    const openTrade = dtos.find((t) => t.status === 'OPEN') ?? null;
    const closed = dtos.filter((t) => t.status !== 'OPEN');

    const wins = closed.filter((t) => t.status === 'CLOSED_TP').length;
    const losses = closed.filter((t) => t.status === 'CLOSED_SL').length;
    const closedEarly = closed.filter((t) => t.status === 'CLOSED_EARLY').length;
    const totalPnlUsd = closed.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);
    const totalR = closed.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);

    return {
      symbol: SYMBOL,
      price,
      openTrade,
      history: closed,
      stats: {
        closedCount: closed.length,
        wins,
        losses,
        closedEarly,
        winRate: closed.length > 0 ? (wins / closed.length) * 100 : null,
        totalPnlUsd,
        totalR,
      },
    };
  }

  /** Non-fatal: the board still renders (without live numbers) if Binance is down. */
  private async fetchPrice(): Promise<number | null> {
    try {
      const candles = await this.marketDataService.getCandles(SYMBOL, '5m', 1);
      return candles[candles.length - 1]?.close ?? null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Live price unavailable for ${SYMBOL} (non-fatal): ${msg}`);
      return null;
    }
  }

  private toDto(row: TradeRow, price: number | null): ScalpPaperTradeDto {
    const direction = row.direction === 'SHORT' ? 'SHORT' : 'LONG';
    const isOpen = row.status === 'OPEN';
    const live = isOpen ? price : null;

    return {
      id: row.id,
      symbol: row.symbol,
      direction,
      status: row.status,
      entryPrice: row.entryPrice,
      initialStopLoss: row.initialStopLoss,
      stopLoss: row.stopLoss,
      takeProfit: row.takeProfit,
      riskUsd: row.riskUsd,
      quantity: row.quantity,
      rrPlanned: row.rrPlanned,
      h1Trend: row.h1Trend,
      reasoning: row.reasoning,
      lastNote: row.lastNote,
      model: row.model,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      exitPrice: row.exitPrice,
      pnlUsd: row.pnlUsd,
      rMultiple: row.rMultiple,
      lastPrice: row.lastPrice,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      unrealizedPnlUsd: live != null ? computeScalpPnlUsd(direction, row.entryPrice, live, row.quantity) : null,
      unrealizedR:
        live != null ? computeScalpRMultiple(direction, row.entryPrice, row.initialStopLoss, live) : null,
    };
  }
}
