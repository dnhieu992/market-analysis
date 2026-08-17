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

/** One row of `/api/v3/ticker/24hr` (only the fields we read; all strings). */
export type Binance24hTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  /** 24h volume denominated in the QUOTE asset (USDT here) — the usable one. */
  quoteVolume: string;
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

  /**
   * Last price for many symbols in one call, keyed by the symbol asked for.
   * Symbols Binance does not list are simply absent from the result rather than
   * failing the batch — the caller decides how to value them.
   */
  async fetchCurrentPrices(symbols: string[]): Promise<Record<string, number>> {
    if (symbols.length === 0) return {};

    const res = await this.client.get<{ symbol: string; price: string }[]>('/api/v3/ticker/price');
    const wanted = new Set(symbols);
    const prices: Record<string, number> = {};

    // Binance 400s the whole batch if any symbol in `symbols=[...]` is unlisted,
    // so pull the full ticker list once and filter locally instead.
    for (const row of res.data ?? []) {
      if (!wanted.has(row.symbol)) continue;
      const price = parseFloat(row.price);
      if (Number.isFinite(price) && price > 0) prices[row.symbol] = price;
    }

    return prices;
  }

  /**
   * Rolling 24h stats for EVERY listed symbol in one call (weight 80, ~1MB).
   *
   * Deliberately unfiltered: Binance 400s the whole batch when any symbol in a
   * `symbols=[...]` list is unlisted (same trap as `fetchCurrentPrices`), and a
   * caller that wants both a few named coins AND market-wide breadth would
   * otherwise need two requests. Filter locally.
   */
  async fetchTicker24h(): Promise<Binance24hTicker[]> {
    const response = await this.client.get<Binance24hTicker[]>('/api/v3/ticker/24hr', {
      timeout: 30_000
    });

    return response.data ?? [];
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
