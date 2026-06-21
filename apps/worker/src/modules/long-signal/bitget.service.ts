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

type BitgetCandleResponse = { code: string; msg: string; data: string[][] };
type BitgetTickerResponse = { code: string; data: Array<{ lastPr: string }> };

/**
 * Public Bitget USDT-futures market data for the Long Signal bot — candle and
 * ticker reads only (no auth). Used to evaluate the M30 UTBot trend and to mark
 * live PAPER positions.
 */
@Injectable()
export class LongSignalBitgetService {
  private readonly logger = new Logger(LongSignalBitgetService.name);
  private readonly client: AxiosInstance = axios.create({ baseURL: 'https://api.bitget.com', timeout: 10_000 });

  /** Fetch klines for a symbol (oldest→newest). granularity e.g. '30m'. */
  async fetchCandles(symbol: string, granularity: string, limit = 300): Promise<Candle[]> {
    try {
      const res = await this.client.get<BitgetCandleResponse>('/api/v2/mix/market/candles', {
        params: { symbol, productType: 'usdt-futures', granularity, limit },
      });
      if (res.data.code !== '00000') {
        this.logger.warn(`Bitget candles error (${symbol} ${granularity}): ${res.data.msg}`);
        return [];
      }
      return res.data.data
        .map((row) => ({
          timestamp: Number(row[0] ?? 0),
          open: parseFloat(row[1] ?? '0'),
          high: parseFloat(row[2] ?? '0'),
          low: parseFloat(row[3] ?? '0'),
          close: parseFloat(row[4] ?? '0'),
          volume: parseFloat(row[6] ?? '0'),
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    } catch (err) {
      this.logger.warn(`Bitget fetchCandles failed (${symbol}): ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async fetchCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const res = await this.client.get<BitgetTickerResponse>('/api/v2/mix/market/ticker', {
        params: { symbol, productType: 'usdt-futures' },
      });
      if (res.data.code !== '00000' || !res.data.data.length) return null;
      const px = res.data.data[0] ? parseFloat(res.data.data[0].lastPr) : NaN;
      return Number.isFinite(px) ? px : null;
    } catch (err) {
      this.logger.warn(`Bitget fetchPrice failed (${symbol}): ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
