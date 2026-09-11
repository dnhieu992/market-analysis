import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  computeScalpPnlUsd,
  computeScalpRMultiple,
  type ScalpDirection,
} from '@app/core';
import { createScalpPaperTradeRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { StorageService } from '../storage/storage.service';
import { renderSetupChart, type OhlcCandle } from '../bitget/setup-chart-renderer';

const SYMBOL = 'BTCUSDT';

/** 15m candles pulled for the entry snapshot — enough to warm the slow EMAs. */
const ENTRY_CHART_LIMIT = 500;
/** How many of those to actually plot (the rest just warm the indicators). */
const ENTRY_CHART_DISPLAY = 200;

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
  /** R2 URL of the 15m entry-moment chart snapshot — null until it's rendered. */
  chartUrl: string | null;
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

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly binance: BinanceMarketDataService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Render the 15m chart at the moment a trade was opened, upload it to R2, and
   * store the URL on the trade row. Called by the scalp-monitor cron right AFTER
   * the position is recorded — deliberately not on the entry path, so a slow
   * render never delays the entry itself. Idempotent-ish: re-rendering an
   * already-charted trade just overwrites the same object key.
   */
  async renderAndAttachEntryChart(tradeId: string): Promise<{ id: string; chartUrl: string }> {
    const trade = await this.repository.findById(tradeId);
    if (!trade) {
      throw new NotFoundException(`Scalp paper trade ${tradeId} not found`);
    }

    const klines = await this.binance.fetchKlines({
      symbol: trade.symbol,
      timeframe: '15m',
      limit: ENTRY_CHART_LIMIT,
    });
    if (klines.length === 0) {
      throw new NotFoundException(`No 15m candles for ${trade.symbol}`);
    }

    const candles: OhlcCandle[] = klines.map((k) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    const buffer = await renderSetupChart({
      symbol: trade.symbol,
      timeframe: '15m',
      candles,
      currentPrice: candles[candles.length - 1]!.close,
      display: ENTRY_CHART_DISPLAY,
      markers: [
        {
          kind: 'open',
          holdSide: trade.direction === 'SHORT' ? 'short' : 'long',
          entryPrice: trade.entryPrice,
        },
      ],
      entryMarker: {
        price: trade.entryPrice,
        side: trade.direction === 'SHORT' ? 'short' : 'long',
      },
    });

    const objectKey = `scalp-charts/${trade.id}.png`;
    const stored = await this.storage.uploadFile(
      { buffer, mimetype: 'image/png', originalname: `${trade.id}.png`, size: buffer.length },
      objectKey,
    );

    await this.repository.update(trade.id, { chartUrl: stored.url, chartObjectKey: stored.key });
    this.logger.log(`Attached 15m entry chart to scalp trade ${trade.id}: ${stored.url}`);
    return { id: trade.id, chartUrl: stored.url };
  }

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
      chartUrl: row.chartUrl ?? null,
    };
  }
}
