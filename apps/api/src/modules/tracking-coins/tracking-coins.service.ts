import { Injectable, NotFoundException } from '@nestjs/common';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { DailyCandleCacheService } from '../market/daily-candle-cache.service';

type CoinSetup = {
  swingMaxLoss: number | null;
  swingMinRR: number | null;
  daytradeMaxLoss: number | null;
  daytradeMinRR: number | null;
};

/**
 * Price change as a ratio (0.0123 = +1.23%) over 7 / 30 / 90 / 180 days, each
 * comparing the current close with the close that many days back. The 24h column
 * is not here: the page reads the exchange's rolling 24h ticker with the price.
 */
export type TrackingPriceChange = {
  symbol: string;
  change7d: number | null;
  change30d: number | null;
  change90d: number | null;
  change180d: number | null;
};

export type TrackingCoinRow = {
  id: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  addedAt: Date;
};

@Injectable()
export class TrackingCoinsService {
  private readonly repo = createTrackingCoinsRepository();

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly dailyCandles: DailyCandleCacheService,
  ) {}

  /**
   * 7d / 30d / 90d / 180d price change per coin — the data behind those table
   * columns. Daily candles come from the shared cache, so this endpoint costs
   * no Binance round trip once `/scores` (or an earlier load) has warmed it.
   */
  async getPriceChanges(symbols: string[]): Promise<TrackingPriceChange[]> {
    const unique = [...new Set(symbols.map((s) => bareSymbol(s)).filter(Boolean))];
    const candlesBySymbol = await this.dailyCandles.getMany(unique);

    return unique.map((bare) => {
      const closes = (candlesBySymbol.get(bare) ?? []).map((c) => c.close);
      const n = closes.length;
      const current = n > 0 ? closes[n - 1]! : NaN;
      // `d` days ago = the close `d` candles back from the current (forming) one.
      const changeAgo = (d: number): number | null => {
        const past = n > d ? closes[n - 1 - d] : undefined;
        return past != null && past > 0 && Number.isFinite(current) ? (current - past) / past : null;
      };
      return {
        symbol: bare,
        change7d: changeAgo(7),
        change30d: changeAgo(30),
        change90d: changeAgo(90),
        change180d: changeAgo(180),
      };
    });
  }

  /**
   * Proxy raw OHLCV klines from Binance (server-side, avoids browser CORS/geo
   * restrictions). Used by the tracking-coins prompt generator to embed candles.
   */
  async fetchKlines(symbol: string, interval: string, limit: number) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 1000);
    // Coins are stored bare (e.g. "ADA"); Binance needs the full pair ("ADAUSDT").
    // Match the scan convention in scanOneCoin so both paths hit the same market.
    const upper = symbol.toUpperCase();
    const binanceSymbol = upper.endsWith('USDT') ? upper : `${upper}USDT`;
    return this.binance.fetchKlines({
      symbol: binanceSymbol,
      timeframe: interval as never,
      limit: safeLimit,
    });
  }

  async listCoins(): Promise<TrackingCoinRow[]> {
    const rows = await this.repo.listCoins();
    return rows.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, marketCap: c.marketCap, addedAt: c.addedAt }));
  }

  async addCoin(symbol: string, name?: string): Promise<{ id: string; symbol: string; name: string }> {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.addCoin(upper, name ?? '');
    return { id: coin.id, symbol: coin.symbol, name: coin.name };
  }

  async removeCoin(symbol: string): Promise<void> {
    const upper = symbol.toUpperCase();
    const existing = await this.repo.findCoinBySymbol(upper);
    if (!existing) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.removeCoin(upper);
  }

  async getSetup(symbol: string) {
    const coin = await this.repo.findCoinBySymbol(symbol.toUpperCase());
    if (!coin) throw new NotFoundException(`Coin ${symbol.toUpperCase()} not found`);
    return {
      swingMaxLoss: coin.swingMaxLoss ?? null,
      swingMinRR: coin.swingMinRR ?? null,
      daytradeMaxLoss: coin.daytradeMaxLoss ?? null,
      daytradeMinRR: coin.daytradeMinRR ?? null,
    };
  }

  async updateSetup(symbol: string, data: Partial<CoinSetup>) {
    const upper = symbol.toUpperCase();
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.updateCoinSetup(coin.id, data);
    return { symbol: upper, ...(await this.getSetup(upper)) };
  }
}

/** Coins are stored bare ("ADA"); accept either form and normalise to bare. */
function bareSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, '');
}
