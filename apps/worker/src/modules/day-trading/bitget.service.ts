import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Bitget REST granularity values (differ from the WS candle channel names):
// valid: 1m,3m,5m,15m,30m,1H,4H,6H,12H,1D,1W,1M
type BitgetGranularity = '1m' | '3m' | '5m' | '15m' | '30m' | '1H' | '4H' | '1D';

type BitgetCandleResponse = {
  code: string;
  msg: string;
  data: string[][];
};

type BitgetTickerResponse = {
  code: string;
  data: Array<{ lastPr: string }>;
};

@Injectable()
export class BitgetService {
  private readonly logger = new Logger(BitgetService.name);
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.bitget.com',
      timeout: 10_000,
    });
  }

  async fetchCandles(granularity: BitgetGranularity, limit = 100): Promise<Candle[]> {
    try {
      const response = await this.client.get<BitgetCandleResponse>('/api/v2/mix/market/candles', {
        params: { symbol: 'BTCUSDT', productType: 'usdt-futures', granularity, limit },
      });
      if (response.data.code !== '00000') {
        this.logger.warn(`Bitget candles error: ${response.data.msg}`);
        return [];
      }
      return response.data.data.map((row) => ({
        timestamp: Number(row[0] ?? 0),
        open: parseFloat(row[1] ?? '0'),
        high: parseFloat(row[2] ?? '0'),
        low: parseFloat(row[3] ?? '0'),
        close: parseFloat(row[4] ?? '0'),
        volume: parseFloat(row[6] ?? '0'),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Bitget fetchCandles failed: ${msg}`);
      return [];
    }
  }

  async fetchCurrentPrice(): Promise<number | null> {
    try {
      const response = await this.client.get<BitgetTickerResponse>('/api/v2/mix/market/ticker', {
        params: { symbol: 'BTCUSDT', productType: 'usdt-futures' },
      });
      if (response.data.code !== '00000' || !response.data.data.length) return null;
      const ticker = response.data.data[0];
      return ticker ? parseFloat(ticker.lastPr) : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Bitget fetchPrice failed: ${msg}`);
      return null;
    }
  }
}
