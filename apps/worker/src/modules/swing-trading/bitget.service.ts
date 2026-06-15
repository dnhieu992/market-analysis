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

// Bitget REST granularity values: 1m,3m,5m,15m,30m,1H,4H,6H,12H,1D,1W,1M
export type BitgetGranularity = '15m' | '30m' | '1H' | '4H' | '1D';

type BitgetCandleResponse = {
  code: string;
  msg: string;
  data: string[][];
};

type BitgetTickerResponse = {
  code: string;
  data: Array<{ lastPr: string }>;
};

/** Maps an app timeframe (e.g. "4h", "1d") to a Bitget REST granularity. */
export function toBitgetGranularity(timeframe: string): BitgetGranularity {
  const tf = timeframe.toLowerCase();
  if (tf === '15m') return '15m';
  if (tf === '30m') return '30m';
  if (tf === '1h') return '1H';
  if (tf === '1d') return '1D';
  return '4H';
}

@Injectable()
export class SwingBitgetService {
  private readonly logger = new Logger(SwingBitgetService.name);
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.bitget.com',
      timeout: 10_000,
    });
  }

  /** Fetch klines for a symbol, returned oldest→newest (ascending by timestamp). */
  async fetchCandles(symbol: string, granularity: BitgetGranularity, limit = 200): Promise<Candle[]> {
    try {
      const response = await this.client.get<BitgetCandleResponse>('/api/v2/mix/market/candles', {
        params: { symbol, productType: 'usdt-futures', granularity, limit },
      });
      if (response.data.code !== '00000') {
        this.logger.warn(`Bitget candles error (${symbol} ${granularity}): ${response.data.msg}`);
        return [];
      }
      const candles = response.data.data.map((row) => ({
        timestamp: Number(row[0] ?? 0),
        open: parseFloat(row[1] ?? '0'),
        high: parseFloat(row[2] ?? '0'),
        low: parseFloat(row[3] ?? '0'),
        close: parseFloat(row[4] ?? '0'),
        volume: parseFloat(row[6] ?? '0'),
      }));
      // Defensive: guarantee ascending order regardless of API ordering.
      return candles.sort((a, b) => a.timestamp - b.timestamp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Bitget fetchCandles failed (${symbol}): ${msg}`);
      return [];
    }
  }

  async fetchCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const response = await this.client.get<BitgetTickerResponse>('/api/v2/mix/market/ticker', {
        params: { symbol, productType: 'usdt-futures' },
      });
      if (response.data.code !== '00000' || !response.data.data.length) return null;
      const ticker = response.data.data[0];
      return ticker ? parseFloat(ticker.lastPr) : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Bitget fetchPrice failed (${symbol}): ${msg}`);
      return null;
    }
  }
}
