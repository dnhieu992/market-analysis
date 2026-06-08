import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { computeSmallCapSignal } from '@app/core';
import { createSmallCapRadarRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

const MARKET_CAP_LIMIT = 50_000_000;
const GECKO_DELAY_MS = 6_500;
const GECKO_RETRY_MS = 35_000;

type GeckoMarket = { id: string; symbol: string; name: string; market_cap: number | null };
type BinanceSymbolInfo = { symbol: string; status: string; quoteAsset: string };

async function geckoGet<T>(url: string, params: Record<string, unknown>, warn: (s: string) => void): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await axios.get<T>(url, { params, timeout: 15_000 });
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
  addedAt: Date;
  signal: {
    rsi: number | null;
    volMultiplier: number | null;
    ema34Above: boolean;
    ema89Above: boolean;
    ema200Above: boolean;
    stage: string;
    signalScore: number;
    sparkline: number[];
    scannedAt: Date;
  } | null;
};

const CANDLE_LIMIT = 220;

@Injectable()
export class SmallCapRadarService {
  private readonly logger = new Logger(SmallCapRadarService.name);
  private readonly repo = createSmallCapRadarRepository();

  constructor(private readonly binance: BinanceMarketDataService) {}

  async listCoins(): Promise<SmallCapCoinWithSignal[]> {
    const rows = await this.repo.findCoinsWithLatestSignal();
    return rows.map((coin) => {
      const sig = coin.signals[0] ?? null;
      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
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
              sparkline: this.parseSparkline(sig.sparklineJson),
              scannedAt: sig.scannedAt,
            }
          : null,
      };
    });
  }

  rescanCoins(): { started: boolean } {
    void this.doRescanCoins();
    return { started: true };
  }

  private async doRescanCoins(): Promise<void> {
    this.logger.log('rescanCoins: start');

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

    // 2. CoinGecko markets (market_cap_asc) — collect all coins < MARKET_CAP_LIMIT listed on Binance
    const kept: { symbol: string; name: string }[] = [];
    let page = 1;
    let consecutiveEmpty = 0;

    while (true) {
      const coins = await geckoGet<GeckoMarket[]>(
        'https://api.coingecko.com/api/v3/coins/markets',
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
          if (binanceSymbols.has(base)) {
            kept.push({ symbol: base, name: coin.name });
          }
        }
      }

      // Stop paging when all 250 coins on this page exceed the threshold
      if (allOverThreshold && coins.every((c) => (c.market_cap ?? 0) >= MARKET_CAP_LIMIT)) break;

      page++;
      await new Promise((r) => setTimeout(r, GECKO_DELAY_MS));
    }

    this.logger.log(`rescanCoins: ${kept.length} small-cap coins found on Binance`);

    // 3. Upsert new / update name
    for (const coin of kept) {
      await this.repo.addCoin(coin.symbol, coin.name);
    }

    // 4. Delete delisted (in DB but not in scan results)
    const keptSymbols = kept.map((c) => c.symbol);
    const deleted = await this.repo.deleteCoinsNotInSymbols(keptSymbols);
    this.logger.log(`rescanCoins: upserted ${kept.length}, removed ${deleted.count}`);
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
        await this.scanOneCoin(coin.id, coin.symbol);
        scanned++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`scan failed for ${coin.symbol}: ${msg}`);
      }
    }

    return { scanned, failed };
  }

  private async scanOneCoin(coinId: string, symbol: string): Promise<void> {
    const klines = await this.binance.fetchKlines({
      symbol: `${symbol}USDT`,
      timeframe: '1d',
      limit: CANDLE_LIMIT,
    });

    if (klines.length < 210) return;

    const closes = klines.map((k) => parseFloat(k[4]));
    const volumes = klines.map((k) => parseFloat(k[5]));

    const result = computeSmallCapSignal(closes, volumes);
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
      sparklineJson: JSON.stringify(result.sparkline),
    });
  }

  private parseSparkline(json: string): number[] {
    try {
      return JSON.parse(json) as number[];
    } catch {
      return [];
    }
  }
}
