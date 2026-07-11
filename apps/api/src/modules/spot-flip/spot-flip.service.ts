import { BadRequestException, Injectable } from '@nestjs/common';
import { computeSpotFlip } from '@app/core';
import {
  createSpotFlipWatchRepository,
  createSpotFlipDailyRepository,
  createSpotFlipLogRepository,
} from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

/**
 * Spot-flip metrics for a single coin. Everything here is aimed at short-term
 * spot swing trading ("lướt spot"): where price sits in its recent range, how
 * much it normally moves per day (so take-profit targets stay realistic), and
 * the raw numbers a flip calculator needs. The fee-net PnL / R:R math is done
 * client-side so it can react instantly as the user edits entry/TP/SL.
 */
export type SpotFlipAnalysis = {
  symbol: string;
  price: number;
  /** % price change over each lookback window (net of nothing — raw move). */
  changes: {
    h1: number | null;
    h4: number | null;
    h24: number | null;
    d7: number | null;
    d30: number | null;
  };
  /** How far below the highest high of the last 30 daily candles (dip depth). */
  pullbackPct: number;
  /** How far above the lowest low of the last 30 daily candles (rebound size). */
  reboundPct: number;
  high30d: number;
  low30d: number;
  /** Average daily range % over the last 14 completed days — the ATR proxy. */
  atrPct: number;
  /** Daily OHLC history (newest first) for the per-coin history dialog. */
  history: SpotFlipHistoryEntry[];
  updatedAt: string;
};

/** One completed daily candle, with its % change vs the previous day's close. */
export type SpotFlipHistoryEntry = {
  /** Candle open day as `YYYY-MM-DD` (UTC). */
  date: string;
  open: number;
  close: number;
  /** % change of close vs the previous day's close (null for the first day). */
  changePct: number | null;
};

/** One coin on the persisted /spot-flip watchlist. */
export type SpotFlipWatchItem = {
  symbol: string;
  name: string;
};

/** One stored daily snapshot (worker cron @ 00:15 UTC) surfaced to the UI. */
export type SpotFlipDailyEntry = {
  /** Snapshot day as `YYYY-MM-DD` (UTC). */
  date: string;
  price: number;
  /** % "tăng giá" (headroom to the 30d high) and its "giảm giá" complement. */
  upPct: number;
  downPct: number;
  pullbackPct: number;
  reboundPct: number;
  atrPct: number;
  changeH24: number | null;
  /** Auto-generated Vietnamese stance note for that day. */
  notes: string | null;
};

/** One manual, timestamped log entry a user added to a coin. */
export type SpotFlipLogEntry = {
  id: string;
  /** Markdown content. */
  content: string;
  /** ISO timestamp (creation time, preserves hh:mm:ss). */
  createdAt: string;
};

const QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'BTC', 'ETH'];

@Injectable()
export class SpotFlipService {
  private readonly watchRepo = createSpotFlipWatchRepository();
  private readonly dailyRepo = createSpotFlipDailyRepository();
  private readonly logRepo = createSpotFlipLogRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  /** The coins the user tracks on /spot-flip (add order). */
  async listWatch(): Promise<SpotFlipWatchItem[]> {
    const rows = await this.watchRepo.findAll();
    return rows.map((r) => ({ symbol: r.symbol, name: r.name }));
  }

  /** Add a coin to the watchlist. Validates it exists on Binance first, so we
   *  never persist a junk symbol. Returns the normalized watch item. */
  async addWatch(rawSymbol: string, name?: string): Promise<SpotFlipWatchItem> {
    const symbol = this.normalizeSymbol(rawSymbol);
    // analyze() throws BadRequestException for unknown/delisted symbols.
    await this.analyze(symbol);
    const row = await this.watchRepo.add(symbol, name ?? '');
    return { symbol: row.symbol, name: row.name };
  }

  /** Remove a coin from the watchlist (idempotent). */
  async removeWatch(rawSymbol: string): Promise<{ removed: boolean }> {
    const symbol = this.normalizeSymbol(rawSymbol);
    try {
      await this.watchRepo.remove(symbol);
      return { removed: true };
    } catch {
      // Not on the list — treat delete as a no-op success.
      return { removed: false };
    }
  }

  /** Normalize user input like "btc" → "BTCUSDT"; leave full pairs untouched. */
  private normalizeSymbol(raw: string): string {
    const symbol = (raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!symbol) throw new BadRequestException('symbol is required');
    const hasQuote = QUOTE_ASSETS.some((q) => symbol.endsWith(q) && symbol.length > q.length);
    return hasQuote ? symbol : `${symbol}USDT`;
  }

  async analyze(rawSymbol: string): Promise<SpotFlipAnalysis> {
    const symbol = this.normalizeSymbol(rawSymbol);

    let price: number;
    let hourly: Awaited<ReturnType<BinanceMarketDataService['fetchKlines']>>;
    let daily: typeof hourly;
    try {
      [price, hourly, daily] = await Promise.all([
        this.binance.fetchCurrentPrice(symbol),
        this.binance.fetchKlines({ symbol, timeframe: '1h', limit: 200 }),
        this.binance.fetchKlines({ symbol, timeframe: '1d', limit: 40 }),
      ]);
    } catch {
      throw new BadRequestException(`Could not load market data for ${symbol}. Check the symbol.`);
    }

    if (daily.length < 2 || hourly.length < 2) {
      throw new BadRequestException(`Not enough market history for ${symbol}.`);
    }

    // All the metric math lives in @app/core so the worker's daily snapshot job
    // computes the exact same numbers.
    const metrics = computeSpotFlip(price, hourly, daily);

    return {
      symbol,
      price,
      ...metrics,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Stored daily snapshot history for a coin (written by the worker cron). */
  async history(rawSymbol: string): Promise<SpotFlipDailyEntry[]> {
    const symbol = this.normalizeSymbol(rawSymbol);
    const rows = await this.dailyRepo.findBySymbol(symbol, 90);
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      price: r.price,
      upPct: r.upPct,
      downPct: r.downPct,
      pullbackPct: r.pullbackPct,
      reboundPct: r.reboundPct,
      atrPct: r.atrPct,
      changeH24: r.changeH24,
      notes: r.notes,
    }));
  }

  /** Manual logs a user has added to a coin (newest first). */
  async listLogs(rawSymbol: string): Promise<SpotFlipLogEntry[]> {
    const symbol = this.normalizeSymbol(rawSymbol);
    const rows = await this.logRepo.findBySymbol(symbol);
    return rows.map((r) => ({ id: r.id, content: r.content, createdAt: r.createdAt.toISOString() }));
  }

  /** Append a new timestamped log entry to a coin. */
  async addLog(rawSymbol: string, content: string): Promise<SpotFlipLogEntry> {
    const symbol = this.normalizeSymbol(rawSymbol);
    const row = await this.logRepo.add(symbol, content);
    return { id: row.id, content: row.content, createdAt: row.createdAt.toISOString() };
  }

  /** Delete a single log entry (idempotent). */
  async removeLog(id: string): Promise<{ removed: boolean }> {
    try {
      await this.logRepo.remove(id);
      return { removed: true };
    } catch {
      return { removed: false };
    }
  }
}
