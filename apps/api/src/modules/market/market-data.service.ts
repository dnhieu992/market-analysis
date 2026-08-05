import { Injectable, Logger } from '@nestjs/common';
import type { Candle } from '@app/core';
import type { AnalysisTimeframe } from '@app/config';

import type { BinanceKlineDto } from './dto/binance-kline.dto';
import { BinanceMarketDataService } from './binance-market-data.service';

/** Bases that track the dollar (or a fiat) — excluded from trend scans. */
const STABLE_BASE_ASSETS = new Set([
  'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USD1', 'PYUSD', 'USDE', 'USDS',
  'FRAX', 'RLUSD', 'BFUSD', 'XUSD', 'VAI',
  'EUR', 'EURI', 'AEUR', 'GBP', 'TRY', 'BRL', 'ARS', 'JPY', 'PLN', 'RON', 'ZAR',
  'MXN', 'COP', 'CZK', 'UAH', 'NGN', 'IDRT', 'BIDR', 'RUB',
]);

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(private readonly binanceMarketDataService: BinanceMarketDataService) {}

  async getCandles(symbol: string, timeframe: AnalysisTimeframe, limit = 250): Promise<Candle[]> {
    const maxAttempts = 2;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const klines = await this.binanceMarketDataService.fetchKlines({
          symbol,
          timeframe,
          limit
        });

        return klines.map((kline) => this.mapKlineToCandle(kline));
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Failed to fetch candles for ${symbol} on attempt ${attempt}/${maxAttempts}`
        );
      }
    }

    throw new Error(
      `Failed to fetch market candles for ${symbol} after ${maxAttempts} attempts`,
      { cause: lastError instanceof Error ? lastError : undefined }
    );
  }

  /**
   * Every actively trading USDT spot pair, minus stablecoin bases (USDCUSDT and
   * friends) whose flat price makes any trend read meaningless.
   */
  async getSpotUsdtSymbols(): Promise<{ symbol: string; baseAsset: string }[]> {
    const symbols = await this.binanceMarketDataService.fetchExchangeInfoSymbols();

    return symbols
      .filter((entry) => entry.status === 'TRADING')
      .filter((entry) => entry.quoteAsset === 'USDT')
      .filter((entry) =>
        entry.permissions?.length
          ? entry.permissions.includes('SPOT')
          : entry.isSpotTradingAllowed !== false
      )
      .filter((entry) => !STABLE_BASE_ASSETS.has(entry.baseAsset))
      .map((entry) => ({ symbol: entry.symbol, baseAsset: entry.baseAsset }));
  }

  async getCandlesInRange(
    symbol: string,
    timeframe: AnalysisTimeframe,
    from: Date,
    to: Date
  ): Promise<Candle[]> {
    const allCandles: Candle[] = [];
    let startTime = from.getTime();
    const endTime = to.getTime();

    while (startTime < endTime) {
      const klines = await this.binanceMarketDataService.fetchKlinesInRange({
        symbol,
        timeframe,
        startTime,
        endTime,
        limit: 1000
      });

      if (klines.length === 0) break;

      allCandles.push(...klines.map((k) => this.mapKlineToCandle(k)));

      const lastKline = klines[klines.length - 1]!;
      startTime = lastKline[6] + 1; // advance past last candle closeTime
    }

    return allCandles;
  }

  private mapKlineToCandle(kline: BinanceKlineDto): Candle {
    return {
      open: Number(kline[1]),
      high: Number(kline[2]),
      low: Number(kline[3]),
      close: Number(kline[4]),
      volume: Number(kline[5]),
      openTime: new Date(kline[0]),
      closeTime: new Date(kline[6])
    };
  }
}
