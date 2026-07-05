import { Injectable, Logger } from '@nestjs/common';
import { computeSmallCapSignal } from '@app/core';
import { createMemeRadarRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

const CANDLE_LIMIT = 220;

@Injectable()
export class MemeScanService {
  private readonly logger = new Logger(MemeScanService.name);
  private readonly repo = createMemeRadarRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  async scanAll(): Promise<{ scanned: number; failed: number }> {
    const coins = await this.repo.findAllCoins();
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      try {
        await this.scanOne(coin.id, coin.symbol, coin.listingDate);
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scan failed for ${coin.symbol}: ${msg}`);
      }
    }

    this.logger.log(`Meme scan done — scanned: ${scanned}, failed: ${failed}`);
    return { scanned, failed };
  }

  async scanOne(coinId: string, symbol: string, currentListingDate?: Date | null): Promise<void> {
    const klines = await this.binance.fetchKlines({
      symbol: `${symbol}USDT`,
      timeframe: '1d',
      limit: CANDLE_LIMIT,
    });

    if (klines.length < 210) {
      this.logger.warn(`Not enough candles for ${symbol}: ${klines.length}`);
      return;
    }

    if (!currentListingDate) {
      void this.fetchAndStoreListingDate(symbol);
    }

    const closes = klines.map((k) => parseFloat(k[4]));
    const highs = klines.map((k) => parseFloat(k[2]));
    const lows = klines.map((k) => parseFloat(k[3]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    if (!result) {
      this.logger.warn(`Signal computation returned null for ${symbol}`);
      return;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await this.repo.upsertSignal(coinId, today, {
      rsi: result.rsi,
      volMultiplier: result.volMultiplier,
      ema34Above: result.ema34Above,
      ema89Above: result.ema89Above,
      ema200Above: result.ema200Above,
      stage: result.stage,
      signalScore: result.signalScore,
      extPct: result.extPct,
      sparklineJson: JSON.stringify(result.sparkline),
      trend: result.trend,
      swingStructure: result.swingStructure,
    });

    // Signal history — append only when the radar stage changes.
    await this.repo.logSignalHistoryIfChanged(coinId, {
      stage: result.stage,
      signalScore: result.signalScore,
      trend: result.trend,
      rsi: result.rsi,
      volMultiplier: result.volMultiplier,
      extPct: result.extPct,
      price: closes[closes.length - 1] ?? null,
    });
  }

  private async fetchAndStoreListingDate(symbol: string): Promise<void> {
    try {
      // Fetch the very first 1d candle — Binance returns from earliest available data
      const klines = await this.binance.fetchKlines({
        symbol: `${symbol}USDT`,
        timeframe: '1d',
        limit: 1,
        startTime: 1483228800000, // 2017-01-01 UTC (before any Binance listing)
      });
      if (klines.length === 0 || klines[0] === undefined) return;
      const listingDate = new Date(klines[0][0]);
      listingDate.setUTCHours(0, 0, 0, 0);
      await this.repo.updateListingDate(symbol, listingDate);
    } catch {
      // non-fatal
    }
  }
}
