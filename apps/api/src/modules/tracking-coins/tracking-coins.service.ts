import { Injectable, NotFoundException } from '@nestjs/common';
import { calcSupertrendState, dcaGomPlan, dcaZone } from '@app/core';
import type { Candle, DcaZone, AccZone, DcaGomPlan, SupertrendState } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

/** Supertrend settings shown on /tracking-coins — ATR 10, multiplier 3. */
const ST_ATR_PERIOD = 10;
const ST_MULTIPLIER = 3;
/** Timeframes the Supertrend column reports on — the page's swing horizon. */
const ST_TIMEFRAMES = ['4h', '1d', '1w'] as const;
/** Every timeframe a caller may ask for. */
const ST_SUPPORTED_TIMEFRAMES = ['M30', '1h', '4h', '1d', '1w'] as const;
/** Candles pulled per timeframe — enough to warm the ATR and find the last flip. */
const ST_KLINE_LIMIT = 200;
/** Min closed candles before a reading is trustworthy. */
const ST_MIN_CANDLES = 30;
/** How long a per-(symbol,tf) reading is reused — flips only happen on candle close. */
const ST_CACHE_TTL_MS = 60_000;

/** Supertrend(10,3) state on one timeframe's last CLOSED candle. */
export type SupertrendTfSignal = SupertrendState;

export type SupertrendSymbolSignals = {
  symbol: string;
  signals: Record<string, SupertrendTfSignal | null>;
};

type CoinSetup = {
  swingMaxLoss: number | null;
  swingMinRR: number | null;
  daytradeMaxLoss: number | null;
  daytradeMinRR: number | null;
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
  private readonly supertrendCache = new Map<string, { at: number; value: SupertrendTfSignal | null }>();

  constructor(private readonly binance: BinanceMarketDataService) {}

  /**
   * Current Supertrend(10,3) direction per timeframe for the given coins,
   * computed live from public Binance klines (no DB, no scan job). Mirrors the
   * QQE column's shape so the table can render both the same way.
   */
  async getSupertrendSignals(symbols: string[], timeframes?: string[]): Promise<SupertrendSymbolSignals[]> {
    const requested = (timeframes ?? []).filter((tf): tf is (typeof ST_SUPPORTED_TIMEFRAMES)[number] =>
      (ST_SUPPORTED_TIMEFRAMES as readonly string[]).includes(tf),
    );
    const tfs: readonly string[] = requested.length > 0 ? requested : ST_TIMEFRAMES;
    const bare = [...new Set(symbols.map((s) => s.trim().toUpperCase().replace(/USDT$/, '')).filter(Boolean))];

    const out: SupertrendSymbolSignals[] = [];
    for (const sym of bare) {
      const signals: Record<string, SupertrendTfSignal | null> = {};
      for (const tf of tfs) {
        signals[tf] = await this.supertrendForTimeframe(sym, tf);
      }
      out.push({ symbol: sym, signals });
    }
    return out;
  }

  /** Supertrend reading for one (coin, timeframe), served from cache when still fresh. */
  private async supertrendForTimeframe(bare: string, tf: string): Promise<SupertrendTfSignal | null> {
    const cacheKey = `${bare}:${tf}`;
    const cached = this.supertrendCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ST_CACHE_TTL_MS) return cached.value;

    try {
      const klines = await this.binance.fetchKlines({
        symbol: `${bare}USDT`,
        timeframe: tf as never,
        limit: ST_KLINE_LIMIT,
      });
      const now = Date.now();
      // Only fully-closed candles — the forming candle would repaint the direction.
      const candles: Candle[] = klines
        .filter((k) => Number(k[6]) <= now)
        .map((k) => ({
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
        }));
      const value =
        candles.length >= ST_MIN_CANDLES
          ? calcSupertrendState(candles, ST_ATR_PERIOD, ST_MULTIPLIER)
          : null;
      this.supertrendCache.set(cacheKey, { at: now, value });
      return value;
    } catch {
      // Transient fetch failure: reuse the last-known reading rather than blanking it.
      return cached?.value ?? null;
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
