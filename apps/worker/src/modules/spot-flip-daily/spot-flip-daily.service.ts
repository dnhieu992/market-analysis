import { Injectable, Logger } from '@nestjs/common';
import { computeSpotFlip, spotFlipShares, spotFlipSummary } from '@app/core';
import { createSpotFlipWatchRepository, createSpotFlipDailyRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

/**
 * Daily spot-flip snapshot job. For every coin on the (active) watchlist it
 * fetches live price + hourly/daily klines, runs the shared `computeSpotFlip`
 * math, and upserts one row per coin per UTC day into `spot_flip_daily` —
 * storing the up/down ratio and an auto-generated Vietnamese stance note, so
 * the page can show how each coin's position evolved day to day.
 *
 * Scheduled from `SchedulerService` at 00:15 UTC (a few minutes after the daily
 * candle closes at 00:00 UTC).
 */
@Injectable()
export class SpotFlipDailyService {
  private readonly logger = new Logger(SpotFlipDailyService.name);
  private readonly watchRepo = createSpotFlipWatchRepository();
  private readonly dailyRepo = createSpotFlipDailyRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  async runDaily(): Promise<{ scanned: number; failed: number }> {
    const coins = await this.watchRepo.findAll();
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      try {
        await this.snapshotOne(coin.symbol);
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`spot-flip snapshot failed for ${coin.symbol}: ${msg}`);
      }
    }

    this.logger.log(`Spot-flip daily snapshot done — scanned: ${scanned}, failed: ${failed}`);
    return { scanned, failed };
  }

  async snapshotOne(symbol: string): Promise<void> {
    const [price, hourly, daily] = await Promise.all([
      this.binance.fetchPrice(symbol),
      this.binance.fetchKlines({ symbol, timeframe: '1h', limit: 200 }),
      this.binance.fetchKlines({ symbol, timeframe: '1d', limit: 40 }),
    ]);

    if (daily.length < 2 || hourly.length < 2) {
      this.logger.warn(`Not enough market history for ${symbol} — skipping snapshot`);
      return;
    }

    const metrics = computeSpotFlip(price, hourly, daily);
    const { upPct, downPct } = spotFlipShares(metrics);
    const notes = spotFlipSummary(metrics);

    // Bucket by UTC day so re-running the job the same day overwrites the row.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await this.dailyRepo.upsert(symbol, today, {
      price,
      upPct,
      downPct,
      pullbackPct: metrics.pullbackPct,
      reboundPct: metrics.reboundPct,
      atrPct: metrics.atrPct,
      high30d: metrics.high30d,
      low30d: metrics.low30d,
      changeH24: metrics.changes.h24,
      notes,
    });
  }
}
