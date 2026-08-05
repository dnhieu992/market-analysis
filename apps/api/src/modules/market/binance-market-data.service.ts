import { Injectable, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import type { AnalysisTimeframe } from '@app/config';

import type { BinanceKlineDto } from './dto/binance-kline.dto';

const BINANCE_INTERVAL: Record<string, string> = {
  '4h': '4h',
  'M30': '30m',
  '1d': '1d',
  '1h': '1h',
  '15m': '15m',
  '1w': '1w'
};

type BinanceKlineParams = {
  symbol: string;
  timeframe: AnalysisTimeframe;
  limit: number;
};

type BinanceKlineRangeParams = BinanceKlineParams & {
  startTime: number;
  endTime: number;
};

export type BinanceExchangeInfoSymbol = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed?: boolean;
  permissions?: string[];
};

@Injectable()
export class BinanceMarketDataService {
  private readonly client: AxiosInstance;

  constructor(@Optional() client?: AxiosInstance) {
    const baseUrl = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';

    this.client = client ?? axios.create({ baseURL: baseUrl, timeout: 10_000 });
  }

  async fetchKlines({ symbol, timeframe, limit }: BinanceKlineParams): Promise<BinanceKlineDto[]> {
    const response = await this.client.get<BinanceKlineDto[]>('/api/v3/klines', {
      params: {
        symbol,
        interval: BINANCE_INTERVAL[timeframe] ?? timeframe,
        limit
      }
    });

    return response.data;
  }

  /** Every symbol Binance lists, with its trading status — ~2MB, weight 20. */
  async fetchExchangeInfoSymbols(): Promise<BinanceExchangeInfoSymbol[]> {
    const response = await this.client.get<{ symbols: BinanceExchangeInfoSymbol[] }>(
      '/api/v3/exchangeInfo',
      { timeout: 30_000 }
    );

    return response.data.symbols ?? [];
  }

  async fetchCurrentPrice(symbol: string): Promise<number> {
    const res = await this.client.get<{ price: string }>('/api/v3/ticker/price', { params: { symbol } });
    return parseFloat(res.data.price);
  }

  async fetchKlinesInRange({
    symbol,
    timeframe,
    startTime,
    endTime,
    limit
  }: BinanceKlineRangeParams): Promise<BinanceKlineDto[]> {
    const response = await this.client.get<BinanceKlineDto[]>('/api/v3/klines', {
      params: {
        symbol,
        interval: BINANCE_INTERVAL[timeframe] ?? timeframe,
        startTime,
        endTime,
        limit
      }
    });

    return response.data;
  }
}
