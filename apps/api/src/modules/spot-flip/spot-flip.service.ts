import { BadRequestException, Injectable } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import type { BinanceKlineDto } from '../market/dto/binance-kline.dto';

/**
 * Spot-flip metrics for a single coin. Everything here is aimed at short-term
 * spot swing trading ("lướt spot"): where price sits in its recent range, how
 * much it normally moves per day (so take-profit targets stay realistic), and
 * the raw numbers a flip calculator needs. The fee-net PnL / R:R math is done
 * client-side so it can react instantly as the user edits entry/TP/SL.
 */
export type SpotFlipAnalysis = {
  symbol: string;
  price: number;
  /** % price change over each lookback window (net of nothing — raw move). */
  changes: {
    h1: number | null;
    h4: number | null;
    h24: number | null;
    d7: number | null;
    d30: number | null;
  };
  /** How far below the highest high of the last 30 daily candles (dip depth). */
  pullbackPct: number;
  /** How far above the lowest low of the last 30 daily candles (rebound size). */
  reboundPct: number;
  high30d: number;
  low30d: number;
  /** Average daily range % over the last 14 completed days — the ATR proxy. */
  atrPct: number;
  updatedAt: string;
};

const QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'BTC', 'ETH'];

@Injectable()
export class SpotFlipService {
  constructor(private readonly binance: BinanceMarketDataService) {}

  /** Normalize user input like "btc" → "BTCUSDT"; leave full pairs untouched. */
  private normalizeSymbol(raw: string): string {
    const symbol = (raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!symbol) throw new BadRequestException('symbol is required');
    const hasQuote = QUOTE_ASSETS.some((q) => symbol.endsWith(q) && symbol.length > q.length);
    return hasQuote ? symbol : `${symbol}USDT`;
  }

  /** close price `k` candles back from the newest (in-progress) candle. */
  private closeAgo(klines: BinanceKlineDto[], k: number): number | null {
    const idx = klines.length - 1 - k;
    if (idx < 0) return null;
    return parseFloat(klines[idx]![4]);
  }

  private pct(price: number, ref: number | null): number | null {
    if (ref == null || ref === 0) return null;
    return ((price - ref) / ref) * 100;
  }

  async analyze(rawSymbol: string): Promise<SpotFlipAnalysis> {
    const symbol = this.normalizeSymbol(rawSymbol);

    let price: number;
    let hourly: BinanceKlineDto[];
    let daily: BinanceKlineDto[];
    try {
      [price, hourly, daily] = await Promise.all([
        this.binance.fetchCurrentPrice(symbol),
        this.binance.fetchKlines({ symbol, timeframe: '1h', limit: 200 }),
        this.binance.fetchKlines({ symbol, timeframe: '1d', limit: 40 }),
      ]);
    } catch {
      throw new BadRequestException(`Could not load market data for ${symbol}. Check the symbol.`);
    }

    if (daily.length < 2 || hourly.length < 2) {
      throw new BadRequestException(`Not enough market history for ${symbol}.`);
    }

    // Momentum windows. Hourly closes for intraday, daily for 30d.
    const changes = {
      h1: this.pct(price, this.closeAgo(hourly, 1)),
      h4: this.pct(price, this.closeAgo(hourly, 4)),
      h24: this.pct(price, this.closeAgo(hourly, 24)),
      d7: this.pct(price, this.closeAgo(hourly, 168)),
      d30: this.pct(price, this.closeAgo(daily, 30)),
    };

    // Range over the last 30 completed daily candles (exclude in-progress).
    const completedDaily = daily.slice(0, -1);
    const last30 = completedDaily.slice(-30);
    const high30d = Math.max(...last30.map((k) => parseFloat(k[2])));
    const low30d = Math.min(...last30.map((k) => parseFloat(k[3])));
    const pullbackPct = high30d > 0 ? ((high30d - price) / high30d) * 100 : 0;
    const reboundPct = low30d > 0 ? ((price - low30d) / low30d) * 100 : 0;

    // ATR proxy: average daily range % over the last 14 completed days.
    const last14 = completedDaily.slice(-14);
    const ranges = last14
      .map((k) => {
        const high = parseFloat(k[2]);
        const low = parseFloat(k[3]);
        const close = parseFloat(k[4]);
        return close > 0 ? ((high - low) / close) * 100 : 0;
      })
      .filter((r) => Number.isFinite(r));
    const atrPct = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;

    return {
      symbol,
      price,
      changes,
      pullbackPct,
      reboundPct,
      high30d,
      low30d,
      atrPct,
      updatedAt: new Date().toISOString(),
    };
  }
}
