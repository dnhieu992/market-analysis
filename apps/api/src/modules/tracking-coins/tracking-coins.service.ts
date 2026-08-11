import { Injectable, NotFoundException } from '@nestjs/common';
import { dcaGomPlan, dcaZone } from '@app/core';
import type { DcaZone, AccZone, DcaGomPlan } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

type CoinSetup = {
  swingMaxLoss: number | null;
  swingMinRR: number | null;
  daytradeMaxLoss: number | null;
  daytradeMinRR: number | null;
};

/** Daily candles pulled for the 7d / 90d change columns (needs ≥ 91 back + today). */
const CHANGE_KLINE_LIMIT = 95;
/** Those changes move once a day — reuse a reading for 5 minutes. */
const CHANGE_CACHE_TTL_MS = 5 * 60_000;

/**
 * Price change as a ratio (0.0123 = +1.23%) over 7 / 90 days, each comparing the
 * current close with the close that many days back. The 24h column is not here:
 * the page reads the exchange's own rolling 24h ticker alongside the live price.
 */
export type TrackingPriceChange = {
  symbol: string;
  change7d: number | null;
  change90d: number | null;
};

export type TrackingCoinWithSignal = {
  id: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  addedAt: Date;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    wEma34Above: boolean | null;
    wEma89Above: boolean | null;
    wEma200Above: boolean | null;
    h4Ema34Above: boolean | null;
    h4Ema89Above: boolean | null;
    h4Ema200Above: boolean | null;
    utBotW1Bullish: boolean | null;
    utBotD1Bullish: boolean | null;
    utBotH4Bullish: boolean | null;
    utBotM30Bullish: boolean | null;
    wRsi: number | null;
    wVolMultiplier: number | null;
    h4Rsi: number | null;
    h4VolMultiplier: number | null;
    m30Ema34Above: boolean | null;
    m30Ema89Above: boolean | null;
    m30Ema200Above: boolean | null;
    m30Rsi: number | null;
    m30VolMultiplier: number | null;
    longScore: number | null;
    shortScore: number | null;
    signalScore: number;
    entryScore: number;
    dcaScore: number;
    dcaZone: DcaZone;
    accZone: AccZone | null;
    accDrawdownPct: number | null;
    accBaseWidthPct: number | null;
    accInBase: boolean | null;
    accGatePassed: boolean | null;
    /** Suggested gom price plan (entry band + −15% ×3 ladder + x2 target) from the base low. */
    gomZone: DcaGomPlan | null;
    extPct: number | null;
    low20Pct: number | null;
    sparkline: number[];
    weekTrend: string;
    trend: string;
    h4Trend: string;
    m30Trend: string;
    swingStructure: string;
    scannedAt: Date;
  } | null;
};

@Injectable()
export class TrackingCoinsService {
  private readonly repo = createTrackingCoinsRepository();
  private readonly changeCache = new Map<string, { at: number; value: TrackingPriceChange }>();

  constructor(private readonly binance: BinanceMarketDataService) {}

  /**
   * 7-day / 90-day price change per coin — the data behind the table's "7d" and
   * "90d" columns. Cached ~5 min per coin (a daily close is all that moves them).
   */
  async getPriceChanges(symbols: string[]): Promise<TrackingPriceChange[]> {
    const unique = [...new Set(symbols.map((s) => bareSymbol(s)).filter(Boolean))];
    const out: TrackingPriceChange[] = [];
    for (const bare of unique) {
      out.push(await this.priceChangeFor(bare));
    }
    return out;
  }

  private async priceChangeFor(bare: string): Promise<TrackingPriceChange> {
    const cached = this.changeCache.get(bare);
    if (cached && Date.now() - cached.at < CHANGE_CACHE_TTL_MS) return cached.value;

    try {
      const klines = await this.binance.fetchKlines({
        symbol: `${bare}USDT`,
        timeframe: '1d' as never,
        limit: CHANGE_KLINE_LIMIT,
      });
      const closes = klines.map((k) => parseFloat(k[4]));
      const n = closes.length;
      const current = n > 0 ? closes[n - 1]! : NaN;
      // `d` days ago = the close `d` candles back from the current (forming) one.
      const changeAgo = (d: number): number | null => {
        const past = n > d ? closes[n - 1 - d] : undefined;
        return past != null && past > 0 && Number.isFinite(current) ? (current - past) / past : null;
      };
      const value: TrackingPriceChange = {
        symbol: bare,
        change7d: changeAgo(7),
        change90d: changeAgo(90),
      };
      this.changeCache.set(bare, { at: Date.now(), value });
      return value;
    } catch {
      // Transient fetch failure: reuse the last-known reading, else blanks.
      return cached?.value ?? { symbol: bare, change7d: null, change90d: null };
    }
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

  async listCoins(): Promise<TrackingCoinWithSignal[]> {
    const rows = await this.repo.findCoinsWithLatestSignal();

    return rows.map((coin) => {
      const sig = coin.signals[0] ?? null;
      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        marketCap: coin.marketCap,
        addedAt: coin.addedAt,
        signal: sig
          ? {
              rsi: sig.rsi,
              volMultiplier: sig.volMultiplier,
              ema34Above: sig.ema34Above,
              ema89Above: sig.ema89Above,
              ema200Above: sig.ema200Above,
              wEma34Above: sig.wEma34Above,
              wEma89Above: sig.wEma89Above,
              wEma200Above: sig.wEma200Above,
              h4Ema34Above: sig.h4Ema34Above,
              h4Ema89Above: sig.h4Ema89Above,
              h4Ema200Above: sig.h4Ema200Above,
              utBotW1Bullish: sig.utBotW1Bullish,
              utBotD1Bullish: sig.utBotD1Bullish,
              utBotH4Bullish: sig.utBotH4Bullish,
              utBotM30Bullish: sig.utBotM30Bullish,
              wRsi: sig.wRsi,
              wVolMultiplier: sig.wVolMultiplier,
              h4Rsi: sig.h4Rsi,
              h4VolMultiplier: sig.h4VolMultiplier,
              m30Ema34Above: sig.m30Ema34Above,
              m30Ema89Above: sig.m30Ema89Above,
              m30Ema200Above: sig.m30Ema200Above,
              m30Rsi: sig.m30Rsi,
              m30VolMultiplier: sig.m30VolMultiplier,
              longScore: sig.longScore,
              shortScore: sig.shortScore,
              signalScore: sig.signalScore,
              entryScore: sig.entryScore,
              dcaScore: sig.dcaScore,
              dcaZone: dcaZone({ ema34Above: sig.ema34Above, rsi: sig.rsi ?? 50, low20Pct: sig.low20Pct }),
              accZone: (sig.accZone as AccZone | null) ?? null,
              accDrawdownPct: sig.accDrawdownPct,
              accBaseWidthPct: sig.accBaseWidthPct,
              accInBase: sig.accInBase,
              accGatePassed: sig.accGatePassed,
              gomZone: dcaGomPlan(sig.accBaseLow ?? null),
              extPct: sig.extPct,
              low20Pct: sig.low20Pct,
              sparkline: this.parseSparkline(sig.sparklineJson),
              weekTrend: sig.weekTrend,
              trend: sig.trend,
              h4Trend: sig.h4Trend,
              m30Trend: sig.m30Trend,
              swingStructure: sig.swingStructure,
              scannedAt: sig.scannedAt,
            }
          : null,
      };
    });
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

  private parseSparkline(json: string): number[] {
    try {
      return JSON.parse(json) as number[];
    } catch {
      return [];
    }
  }
}

/** Coins are stored bare ("ADA"); accept either form and normalise to bare. */
function bareSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/USDT$/, '');
}
