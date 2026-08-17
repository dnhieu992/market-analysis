import { Injectable, Logger } from '@nestjs/common';

import { BinanceMarketDataService, type Binance24hTicker } from '../market/binance-market-data.service';

/**
 * Builds the factual picture of "the crypto market today" that the DeepSeek
 * agent reasons over.
 *
 * The model itself has no live data and no browsing, so anything it is not
 * handed here it would have to invent. Everything below therefore comes from
 * Binance's public REST API — one heavy `/ticker/24hr` call (weight 80) that
 * covers majors, breadth and movers at once, plus one daily-kline call per
 * anchor coin for the multi-day trend.
 */

/** The coins the brief always reports on, in the order they are shown. */
const MAJORS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'TONUSDT',
] as const;

/** Coins we also pull daily candles for, to add 7d/30d context to the brief. */
const TREND_ANCHORS = ['BTCUSDT', 'ETHUSDT'] as const;

/** How many gainers/losers the brief lists. */
const MOVERS_LIMIT = 5;
/**
 * Minimum 24h quote volume for a coin to qualify as a "top mover". Without a
 * floor the list is just illiquid microcaps whose 300% move is one $500 order —
 * noise, not market information.
 *
 * Kept deliberately low: a floor that only a dozen pairs clear turns the movers
 * list into "the majors, re-sorted" (measured on a quiet day: at $20M only 8
 * pairs qualified, which put ETH at +0.06% among the top gainers and BTC among
 * the top losers). $2M still excludes the dust while leaving a real field.
 */
export const MIN_MOVER_VOLUME_USD = 2_000_000;
/**
 * Leveraged tokens and fiat/stablecoin pairs move for mechanical reasons, so
 * they are excluded from breadth and movers alike.
 */
const EXCLUDED_BASE = /(UP|DOWN|BULL|BEAR)$/;
const STABLE_BASES = new Set([
  // Stablecoins — a USDT pair against another dollar peg is a spread, not a move.
  'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USD1', 'PYUSD', 'USDP', 'USDE', 'XUSD',
  // Fiat quoted against USDT — an FX rate, not a crypto move.
  'EUR', 'EURI', 'AEUR', 'GBP', 'AUD', 'JPY', 'TRY', 'BRL', 'ARS', 'RUB', 'ZAR',
  'UAH', 'NGN', 'PLN', 'RON', 'CZK', 'COP', 'MXN', 'IDRT',
]);

/** Daily candles pulled per anchor — enough for a 30-day change plus today. */
const TREND_KLINE_LIMIT = 32;

export type MarketTicker = {
  symbol: string;
  /** Symbol without the USDT suffix, for display. */
  coin: string;
  price: number;
  /** 24h change in percent (12.3 = +12.3%). */
  change24hPct: number;
  high24h: number;
  low24h: number;
  /** 24h volume in USDT. */
  volumeUsd: number;
};

export type TrendAnchor = {
  coin: string;
  price: number;
  change24hPct: number;
  /** Change vs the daily close 7 days ago, in percent. Null when unavailable. */
  change7dPct: number | null;
  /** Change vs the daily close 30 days ago, in percent. Null when unavailable. */
  change30dPct: number | null;
};

export type MarketBreadth = {
  /** USDT pairs considered (after excluding stables and leveraged tokens). */
  pairs: number;
  advancing: number;
  declining: number;
  unchanged: number;
  /** advancing ÷ (advancing + declining), in percent. */
  advancingPct: number;
  /** Total 24h USDT volume across the considered pairs. */
  totalVolumeUsd: number;
};

export type MarketSnapshot = {
  capturedAt: string;
  majors: MarketTicker[];
  anchors: TrendAnchor[];
  breadth: MarketBreadth;
  topGainers: MarketTicker[];
  topLosers: MarketTicker[];
};

const num = (v: string | number | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

@Injectable()
export class MarketSnapshotService {
  private readonly logger = new Logger(MarketSnapshotService.name);

  constructor(private readonly binance: BinanceMarketDataService) {}

  /**
   * The whole snapshot. The ticker call is required — without it there is no
   * market data and the agent would have nothing honest to say — while the
   * per-anchor trend lookups are best-effort and degrade to nulls.
   */
  async build(): Promise<MarketSnapshot> {
    const tickers = await this.binance.fetchTicker24h();
    const usdtPairs = tickers.filter((t) => this.isTradablePair(t.symbol));

    const bySymbol = new Map(usdtPairs.map((t) => [t.symbol, t]));
    const majors = MAJORS.map((symbol) => bySymbol.get(symbol))
      .filter((t): t is Binance24hTicker => t != null)
      .map((t) => this.toTicker(t));

    const ranked = usdtPairs
      .filter((t) => num(t.quoteVolume) >= MIN_MOVER_VOLUME_USD)
      .map((t) => this.toTicker(t))
      .sort((a, b) => b.change24hPct - a.change24hPct);

    // Split by direction rather than head/tail slicing: on a day when few pairs
    // clear the volume floor the two slices would otherwise overlap, and a coin
    // would be reported as both a top gainer and a top loser.
    const topGainers = ranked.filter((t) => t.change24hPct > 0).slice(0, MOVERS_LIMIT);
    const decliners = ranked.filter((t) => t.change24hPct < 0);

    return {
      capturedAt: new Date().toISOString(),
      majors,
      anchors: await this.buildAnchors(bySymbol),
      breadth: this.buildBreadth(usdtPairs),
      topGainers,
      topLosers: decliners.slice(-MOVERS_LIMIT).reverse(),
    };
  }

  /** Spot USDT pair that is neither a stablecoin pair nor a leveraged token. */
  private isTradablePair(symbol: string): boolean {
    if (!symbol.endsWith('USDT')) return false;
    const base = symbol.slice(0, -4);
    if (!base || EXCLUDED_BASE.test(base)) return false;
    return !STABLE_BASES.has(base);
  }

  private toTicker(t: Binance24hTicker): MarketTicker {
    return {
      symbol: t.symbol,
      coin: t.symbol.slice(0, -4),
      price: num(t.lastPrice),
      change24hPct: num(t.priceChangePercent),
      high24h: num(t.highPrice),
      low24h: num(t.lowPrice),
      volumeUsd: num(t.quoteVolume),
    };
  }

  /**
   * How much of the market is up vs down on the day — the single number that
   * separates "BTC is up and so is everything" from "BTC is up alone".
   */
  private buildBreadth(pairs: Binance24hTicker[]): MarketBreadth {
    let advancing = 0;
    let declining = 0;
    let unchanged = 0;
    let totalVolumeUsd = 0;

    for (const t of pairs) {
      const change = num(t.priceChangePercent);
      if (change > 0) advancing++;
      else if (change < 0) declining++;
      else unchanged++;
      totalVolumeUsd += num(t.quoteVolume);
    }

    const decided = advancing + declining;
    return {
      pairs: pairs.length,
      advancing,
      declining,
      unchanged,
      advancingPct: decided > 0 ? (advancing / decided) * 100 : 0,
      totalVolumeUsd,
    };
  }

  /** 24h/7d/30d change for the anchor coins. A failed lookup yields nulls. */
  private async buildAnchors(bySymbol: Map<string, Binance24hTicker>): Promise<TrendAnchor[]> {
    return Promise.all(
      TREND_ANCHORS.map(async (symbol) => {
        const ticker = bySymbol.get(symbol);
        const base: TrendAnchor = {
          coin: symbol.slice(0, -4),
          price: num(ticker?.lastPrice),
          change24hPct: num(ticker?.priceChangePercent),
          change7dPct: null,
          change30dPct: null,
        };

        try {
          const klines = await this.binance.fetchKlines({
            symbol,
            timeframe: '1d',
            limit: TREND_KLINE_LIMIT,
          });
          const closes = klines.map((k) => parseFloat(String(k[4])));
          const current = closes[closes.length - 1];
          // `d` days ago = the close `d` candles back from the current (forming) one.
          const changeAgo = (d: number): number | null => {
            const past = closes.length > d ? closes[closes.length - 1 - d] : undefined;
            return past != null && past > 0 && current != null && Number.isFinite(current)
              ? ((current - past) / past) * 100
              : null;
          };
          return { ...base, change7dPct: changeAgo(7), change30dPct: changeAgo(30) };
        } catch (err) {
          // Non-fatal: the brief still has the 24h picture, just no multi-day context.
          this.logger.warn(`Failed to fetch daily trend for ${symbol}: ${(err as Error).message}`);
          return base;
        }
      }),
    );
  }
}
