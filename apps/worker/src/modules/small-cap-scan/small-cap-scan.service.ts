import { Injectable, Logger } from '@nestjs/common';
import { computeSmallCapSignal } from '@app/core';
import { createSmallCapRadarRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

const CANDLE_LIMIT = 220;

@Injectable()
export class SmallCapScanService {
  private readonly logger = new Logger(SmallCapScanService.name);
  private readonly repo = createSmallCapRadarRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  async scanAll(): Promise<{ scanned: number; failed: number }> {
    const coins = await this.repo.findAllCoins();
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      try {
        await this.scanOne(coin.id, coin.symbol);
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scan failed for ${coin.symbol}: ${msg}`);
      }
    }

    this.logger.log(`Small-cap scan done — scanned: ${scanned}, failed: ${failed}`);
    return { scanned, failed };
  }

  async scanOne(coinId: string, symbol: string): Promise<void> {
    const klines = await this.binance.fetchKlines({
      symbol: `${symbol}USDT`,
      timeframe: '1d',
      limit: CANDLE_LIMIT,
    });

    if (klines.length < 210) {
      this.logger.warn(`Not enough candles for ${symbol}: ${klines.length}`);
      return;
    }

    const closes = klines.map((k) => parseFloat(k[4]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, volumes);
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
      sparklineJson: JSON.stringify(result.sparkline),
    });
  }
}
