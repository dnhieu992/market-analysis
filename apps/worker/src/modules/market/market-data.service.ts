import { Injectable, Logger } from '@nestjs/common';
import type { Candle } from '@app/core';
import type { AnalysisTimeframe } from '@app/config';

import type { BinanceKlineDto } from './dto/binance-kline.dto';
import { BinanceMarketDataService } from './binance-market-data.service';

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
