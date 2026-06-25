import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { computeSmallCapSignal } from '@app/core';
import { createTopCapRadarRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

export type TopCapCoinWithSignal = {
  id: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  listingDate: Date | null;
  addedAt: Date;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    stage: string;
    signalScore: number;
    extPct: number | null;
    sparkline: number[];
    trend: string;
    swingStructure: string;
    scannedAt: Date;
  } | null;
};

const CANDLE_LIMIT = 220;

@Injectable()
export class TopCapRadarService {
  private readonly logger = new Logger(TopCapRadarService.name);
  private readonly repo = createTopCapRadarRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  async listCoins(): Promise<TopCapCoinWithSignal[]> {
    const rows = await this.repo.findCoinsWithLatestSignal();
    return rows.map((coin) => {
      const sig = coin.signals[0] ?? null;
      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        marketCap: coin.marketCap,
        listingDate: coin.listingDate,
        addedAt: coin.addedAt,
        signal: sig
          ? {
              rsi: sig.rsi,
              volMultiplier: sig.volMultiplier,
              ema34Above: sig.ema34Above,
              ema89Above: sig.ema89Above,
              ema200Above: sig.ema200Above,
              stage: sig.stage,
              signalScore: sig.signalScore,
              extPct: sig.extPct,
              sparkline: this.parseSparkline(sig.sparklineJson),
              trend: sig.trend,
              swingStructure: sig.swingStructure,
              scannedAt: sig.scannedAt,
            }
          : null,
      };
    });
  }

  async addCoin(symbol: string, name?: string): Promise<{ id: string; symbol: string; name: string }> {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.addCoin(upper, name ?? '');
    return { id: coin.id, symbol: coin.symbol, name: coin.name };
  }

  async removeCoin(symbol: string): Promise<void> {
    const upper = symbol.toUpperCase();
    const existing = await this.repo.findCoinBySymbol(upper);
    if (!existing) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.removeCoin(upper);
  }

  async triggerScan(): Promise<{ scanned: number; failed: number }> {
    const coins = await this.repo.findAllCoins();
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      try {
        await this.scanOneCoin(coin.id, coin.symbol, coin.listingDate);
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scan failed for ${coin.symbol}: ${msg}`);
      }
    }

    return { scanned, failed };
  }

  private async scanOneCoin(coinId: string, symbol: string, currentListingDate?: Date | null): Promise<void> {
    const klines = await this.binance.fetchKlines({
      symbol: `${symbol}USDT`,
      timeframe: '1d',
      limit: CANDLE_LIMIT,
    });

    if (klines.length < 210) return;

    if (!currentListingDate) {
      void this.fetchAndStoreListingDate(symbol);
    }

    const closes = klines.map((k) => parseFloat(k[4]));
    const highs = klines.map((k) => parseFloat(k[2]));
    const lows = klines.map((k) => parseFloat(k[3]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    if (!result) return;

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
  }

  private async fetchAndStoreListingDate(symbol: string): Promise<void> {
    try {
      const klines = await this.binance.fetchKlinesInRange({
        symbol: `${symbol}USDT`,
        timeframe: '1d',
        startTime: 1483228800000, // 2017-01-01 UTC
        endTime: Date.now(),
        limit: 1,
      });
      if (klines.length === 0 || klines[0] === undefined) return;
      const listingDate = new Date(klines[0][0]);
      listingDate.setUTCHours(0, 0, 0, 0);
      await this.repo.updateListingDate(symbol, listingDate);
    } catch {
      // non-fatal
    }
  }

  private parseSparkline(json: string): number[] {
    try {
      return JSON.parse(json) as number[];
    } catch {
      return [];
    }
  }
}
