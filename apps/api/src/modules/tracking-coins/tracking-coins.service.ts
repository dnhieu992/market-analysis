import { Injectable, NotFoundException } from '@nestjs/common';
import { createTrackingCoinsRepository, prisma } from '@app/db';

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

/** Live price + rolling 24h change (ratio) per bare symbol. */
export type TrackingTicker = {
  symbol: string;
  price: number;
  change24h: number | null;
};

/**
 * One market-wide ticker fetch serves every viewer for this long. The page polls
 * every few seconds; without the shared cache each open tab would cost Binance
 * weight 80 per poll.
 */
const TICKER_TTL_MS = 5_000;

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

  private tickerCache: { at: number; byPair: Map<string, { price: number; change24h: number | null }> } | null = null;
  private tickerInFlight: Promise<Map<string, { price: number; change24h: number | null }>> | null = null;

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly dailyCandles: DailyCandleCacheService,
  ) {}

  /**
   * Price + rolling 24h change for the given coins. Reads the whole-market MINI
   * ticker (cached {@link TICKER_TTL_MS}, concurrent callers share one request)
   * and filters locally — a `symbols=[...]` batch 400s entirely when a single
   * coin is not a Binance spot pair (e.g. the futures-only "1000SHIB"), which is
   * what blanked the Price / 24h columns. "1000X" falls back to X × 1000.
   * On a Binance failure the last good snapshot is served (stale beats blank).
   */
  async getTickers(symbols: string[]): Promise<TrackingTicker[]> {
    const unique = [...new Set(symbols.map((s) => bareSymbol(s)).filter(Boolean))];
    if (unique.length === 0) return [];
    const byPair = await this.loadTickers();

    const out: TrackingTicker[] = [];
    for (const bare of unique) {
      const direct = byPair.get(`${bare}USDT`);
      if (direct) { out.push({ symbol: bare, ...direct }); continue; }
      const m = /^1000+(.+)$/.exec(bare);
      const base = m ? byPair.get(`${m[1]}USDT`) : undefined;
      if (m && base) {
        const mult = Number(bare.slice(0, bare.length - m[1]!.length));
        out.push({ symbol: bare, price: base.price * mult, change24h: base.change24h });
      }
    }
    return out;
  }

  private async loadTickers() {
    if (this.tickerCache && Date.now() - this.tickerCache.at < TICKER_TTL_MS) return this.tickerCache.byPair;
    if (this.tickerInFlight) return this.tickerInFlight;

    this.tickerInFlight = (async () => {
      try {
        const rows = await this.binance.fetchTicker24hMini();
        const byPair = new Map<string, { price: number; change24h: number | null }>();
        for (const r of rows) {
          if (!r.symbol.endsWith('USDT')) continue;
          const price = parseFloat(r.lastPrice);
          const open = parseFloat(r.openPrice);
          if (!Number.isFinite(price) || price <= 0) continue;
          byPair.set(r.symbol, { price, change24h: open > 0 ? (price - open) / open : null });
        }
        this.tickerCache = { at: Date.now(), byPair };
        return byPair;
      } catch (err) {
        if (this.tickerCache) return this.tickerCache.byPair;
        throw err;
      } finally {
        this.tickerInFlight = null;
      }
    })();
    return this.tickerInFlight;
  }

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

  async ratings(): Promise<Array<{ symbol: string; rating: number }>> {
    return prisma.trackingCoin.findMany({ select: { symbol: true, rating: true } });
  }

  async setRating(symbol: string, rating: number) {
    const upper = bareSymbol(symbol);
    const coin = await this.repo.findCoinBySymbol(upper);
    if (!coin) throw new NotFoundException(`Coin ${upper} not found`);
    await prisma.trackingCoin.update({ where: { id: coin.id }, data: { rating } });
    return { symbol: upper, rating };
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
