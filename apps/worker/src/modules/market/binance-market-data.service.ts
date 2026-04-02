import { Injectable, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import type { AnalysisTimeframe } from '@app/config';

import type { BinanceKlineDto } from './dto/binance-kline.dto';

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

  async fetchKlines({
    symbol,
    timeframe,
    limit
  }: BinanceKlineParams): Promise<BinanceKlineDto[]> {
    const response = await this.client.get<BinanceKlineDto[]>('/api/v3/klines', {
      params: {
        symbol,
        interval: timeframe,
        limit
      }
    });

    return response.data;
  }
}
