import { Injectable, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import type { AnalysisTimeframe } from '@app/config';

import type { BinanceKlineDto } from './dto/binance-kline.dto';

const BINANCE_INTERVAL: Record<string, string> = {
  '4h': '4h',
  'M30': '30m',
  '1d': '1d'
};

type BinanceKlineParams = {
  symbol: string;
  timeframe: AnalysisTimeframe;
  limit: number;
};

@Injectable()
export class BinanceMarketDataService {
  private readonly client: AxiosInstance;

  constructor(@Optional() client?: AxiosInstance) {
    const baseUrl = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';

    this.client = client ?? axios.create({ baseURL: baseUrl, timeout: 10_000 });
  }

  async fetchPrice(symbol: string): Promise<number> {
    const response = await this.client.get<{ price: string }>('/api/v3/ticker/price', {
      params: { symbol }
    });

    return parseFloat(response.data.price);
  }

  async fetchKlines({
    symbol,
    timeframe,
    limit
  }: BinanceKlineParams): Promise<BinanceKlineDto[]> {
    const response = await this.client.get<BinanceKlineDto[]>('/api/v3/klines', {
      params: {
        symbol,
        interval: BINANCE_INTERVAL[timeframe] ?? timeframe,
        limit
      }
    });

    return response.data;
  }
}
