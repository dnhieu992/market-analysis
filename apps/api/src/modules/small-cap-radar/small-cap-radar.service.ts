import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { computeSmallCapSignal } from '@app/core';
import { createSmallCapRadarRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

const MARKET_CAP_LIMIT = 50_000_000;
const GECKO_DELAY_MS = 12_000;
const GECKO_RETRY_MS = 60_000;

type GeckoMarket = { id: string; symbol: string; name: string; market_cap: number | null };
type KeepCoin = { symbol: string; name: string; marketCap: number | null };
type BinanceSymbolInfo = { symbol: string; status: string; quoteAsset: string };

function geckoHeaders(): Record<string, string> {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) return {};
  // Pro keys start with "CG-" and use a different base URL (handled at call site)
  return key.startsWith('CG-')
    ? { 'x-cg-pro-api-key': key }
    : { 'x-cg-demo-api-key': key };
}

function geckoBaseUrl(): string {
  const key = process.env.COINGECKO_API_KEY;
  return key?.startsWith('CG-') ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
}

async function geckoGet<T>(path: string, params: Record<string, unknown>, warn: (s: string) => void): Promise<T | null> {
  const url = `${geckoBaseUrl()}${path}`;
  const headers = geckoHeaders();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.get<T>(url, { params, headers, timeout: 15_000 });
      return res.data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429 && attempt < 2) {
        warn(`CoinGecko 429 — waiting ${GECKO_RETRY_MS / 1000}s`);
        await new Promise((r) => setTimeout(r, GECKO_RETRY_MS));
        continue;
      }
      warn(`CoinGecko failed: ${url} — ${String(err)}`);
      return null;
    }
  }
  return null;
}

export type SmallCapCoinWithSignal = {
  id: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  listingDate: Date | null;
  addedAt: Date;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    stage: string;
    signalScore: number;
    extPct: number | null;
    sparkline: number[];
    trend: string;
    swingStructure: string;
    scannedAt: Date;
  } | null;
};

const CANDLE_LIMIT = 220;

@Injectable()
export class SmallCapRadarService {
  private readonly logger = new Logger(SmallCapRadarService.name);
  private readonly repo = createSmallCapRadarRepository();
  private rescanRunning = false;

  constructor(private readonly binance: BinanceMarketDataService) {}

  async listCoins(): Promise<SmallCapCoinWithSignal[]> {
    const rows = await this.repo.findCoinsWithLatestSignal();
    return rows.map((coin) => {
      const sig = coin.signals[0] ?? null;
      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        marketCap: coin.marketCap,
        listingDate: coin.listingDate,
        addedAt: coin.addedAt,
        signal: sig
          ? {
              rsi: sig.rsi,
              volMultiplier: sig.volMultiplier,
              ema34Above: sig.ema34Above,
              ema89Above: sig.ema89Above,
              ema200Above: sig.ema200Above,
              stage: sig.stage,
              signalScore: sig.signalScore,
              extPct: sig.extPct,
              sparkline: this.parseSparkline(sig.sparklineJson),
              trend: sig.trend,
              swingStructure: sig.swingStructure,
              scannedAt: sig.scannedAt,
            }
          : null,
      };
    });
  }

  rescanCoins(): { started: boolean; alreadyRunning?: boolean } {
    if (this.rescanRunning) {
      this.logger.warn('rescanCoins: already running, skipping duplicate request');
      return { started: false, alreadyRunning: true };
    }
    void this.doRescanCoins();
    return { started: true };
  }

  private async doRescanCoins(): Promise<void> {
    this.rescanRunning = true;
    this.logger.log('rescanCoins: start');
    try {
    // 1. Binance USDT spot pairs
    let binanceSymbols: Set<string>;
    try {
      const res = await axios.get<{ symbols: BinanceSymbolInfo[] }>(
        'https://api.binance.com/api/v3/exchangeInfo',
        { timeout: 30_000 },
      );
      const bases = res.data.symbols
        .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map((s) => s.symbol.replace(/USDT$/, ''));
      binanceSymbols = new Set(bases);
    } catch (err) {
      this.logger.error(`rescanCoins: Binance fetch failed — ${String(err)}`);
      return;
    }
    this.logger.log(`rescanCoins: ${binanceSymbols.size} Binance USDT pairs`);

    // 2a. CoinGecko top-500 by market cap — build blocklist of large-cap symbols
    // This prevents symbol collisions (e.g. a $30K "Bitcoin Base" token with symbol BTC
    // would otherwise map to BTCUSDT on Binance, which is real Bitcoin).
    const largeCapSymbols = new Set<string>();
    for (const blockPage of [1, 2]) {
      const topCoins = await geckoGet<GeckoMarket[]>(
        '/coins/markets',
        { vs_currency: 'usd', order: 'market_cap_desc', per_page: 250, page: blockPage, sparkline: false },
        (s) => this.logger.warn(s),
      );
      if (topCoins) {
        for (const c of topCoins) largeCapSymbols.add(c.symbol.toUpperCase());
      }
      await new Promise((r) => setTimeout(r, GECKO_DELAY_MS));
    }
    this.logger.log(`rescanCoins: ${largeCapSymbols.size} large-cap symbols blocked`);

    // 2b. CoinGecko markets (market_cap_asc) — collect all coins < MARKET_CAP_LIMIT listed on Binance
    const kept: KeepCoin[] = [];
    let page = 1;
    let consecutiveEmpty = 0;

    while (true) {
      const coins = await geckoGet<GeckoMarket[]>(
        '/coins/markets',
        { vs_currency: 'usd', order: 'market_cap_asc', per_page: 250, page, sparkline: false },
        (s) => this.logger.warn(s),
      );

      if (!coins || coins.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) break;
        page++;
        await new Promise((r) => setTimeout(r, GECKO_DELAY_MS));
        continue;
      }
      consecutiveEmpty = 0;

      let allOverThreshold = true;
      for (const coin of coins) {
        const cap = coin.market_cap ?? 0;
        if (cap > 0 && cap < MARKET_CAP_LIMIT) {
          allOverThreshold = false;
          const base = coin.symbol.toUpperCase();
          // Skip if this symbol belongs to a large-cap coin (symbol collision guard)
          if (binanceSymbols.has(base) && !largeCapSymbols.has(base)) {
            kept.push({ symbol: base, name: coin.name, marketCap: cap });
          }
        }
      }

      // Stop paging when all 250 coins on this page exceed the threshold
      if (allOverThreshold && coins.every((c) => (c.market_cap ?? 0) >= MARKET_CAP_LIMIT)) break;

      page++;
      await new Promise((r) => setTimeout(r, GECKO_DELAY_MS));
    }

    this.logger.log(`rescanCoins: ${kept.length} small-cap coins found on Binance`);

    // 3. Upsert new / update name + marketCap
    for (const coin of kept) {
      await this.repo.addCoin(coin.symbol, coin.name, coin.marketCap);
    }

    // 4. Delete delisted (in DB but not in scan results)
    // Guard: skip deletion if sync found nothing — CoinGecko may have failed or rate-limited,
    // and deleteCoinsNotInSymbols([]) would wipe the entire table.
    const keptSymbols = kept.map((c) => c.symbol);
    if (keptSymbols.length > 0) {
      const deleted = await this.repo.deleteCoinsNotInSymbols(keptSymbols);
      this.logger.log(`rescanCoins: upserted ${kept.length}, removed ${deleted.count}`);
    } else {
      this.logger.warn('rescanCoins: 0 coins found — skipping deletion to protect existing watchlist');
    }
    } finally {
      this.rescanRunning = false;
    }
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

  async triggerScan(): Promise<{ scanned: number; failed: number }> {
    const coins = await this.repo.findAllCoins();
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      try {
        await this.scanOneCoin(coin.id, coin.symbol, coin.listingDate);
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scan failed for ${coin.symbol}: ${msg}`);
      }
    }

    return { scanned, failed };
  }

  private async scanOneCoin(coinId: string, symbol: string, currentListingDate?: Date | null): Promise<void> {
    const klines = await this.binance.fetchKlines({
      symbol: `${symbol}USDT`,
      timeframe: '1d',
      limit: CANDLE_LIMIT,
    });

    if (klines.length < 210) return;

    if (!currentListingDate) {
      void this.fetchAndStoreListingDate(symbol);
    }

    const closes = klines.map((k) => parseFloat(k[4]));
    const highs = klines.map((k) => parseFloat(k[2]));
    const lows = klines.map((k) => parseFloat(k[3]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, highs, lows, volumes);
    if (!result) return;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await this.repo.upsertSignal(coinId, today, {
      rsi: result.rsi,
      volMultiplier: result.volMultiplier,
      ema34Above: result.ema34Above,
      ema89Above: result.ema89Above,
      ema200Above: result.ema200Above,
      stage: result.stage,
      signalScore: result.signalScore,
      extPct: result.extPct,
      sparklineJson: JSON.stringify(result.sparkline),
      trend: result.trend,
      swingStructure: result.swingStructure,
    });
  }

  private async fetchAndStoreListingDate(symbol: string): Promise<void> {
    try {
      const klines = await this.binance.fetchKlinesInRange({
        symbol: `${symbol}USDT`,
        timeframe: '1d',
        startTime: 1483228800000, // 2017-01-01 UTC
        endTime: Date.now(),
        limit: 1,
      });
      if (klines.length === 0 || klines[0] === undefined) return;
      const listingDate = new Date(klines[0][0]);
      listingDate.setUTCHours(0, 0, 0, 0);
      await this.repo.updateListingDate(symbol, listingDate);
    } catch {
      // non-fatal
    }
  }

  private parseSparkline(json: string): number[] {
    try {
      return JSON.parse(json) as number[];
    } catch {
      return [];
    }
  }
}
