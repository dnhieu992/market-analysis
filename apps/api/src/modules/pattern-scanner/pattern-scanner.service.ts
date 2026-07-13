import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { scanChartPatterns, calculateRsi, calculateEma } from '@app/core';
import type { PatternKind, PatternMatch } from '@app/core';
import { createPatternScannerRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { StorageService } from '../storage/storage.service';

const CANDLE_LIMIT = 300;
const MIN_CANDLES = 60;

export type CoinIndicators = {
  rsi: number;
  ema34: number;
  ema89: number;
  ema200: number;
};

export type PatternScanCoinResult = {
  symbol: string;
  name: string;
  price: number;
  /** OHLC series used for the scan (oldest → newest, parallel arrays); pivot `idx` indexes into these. Lets the UI draw a candlestick of the pattern. */
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  matches: PatternMatch[];
  indicators: CoinIndicators;
};

export type PatternScanResult = {
  scannedAt: string;
  timeframe: string;
  patterns: PatternKind[];
  scanned: number;
  failed: number;
  coins: PatternScanCoinResult[];
};

@Injectable()
export class PatternScannerService {
  private readonly logger = new Logger(PatternScannerService.name);
  private readonly repo = createPatternScannerRepository();

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly storage: StorageService,
  ) {}

  async listCoins() {
    const rows = await this.repo.findAllCoins();
    return rows.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, addedAt: c.addedAt.toISOString() }));
  }

  async addCoin(symbol: string, name?: string) {
    const upper = symbol.trim().toUpperCase().replace(/USDT$/, '');
    const coin = await this.repo.addCoin(upper, name ?? '');
    return { id: coin.id, symbol: coin.symbol, name: coin.name, addedAt: coin.addedAt.toISOString() };
  }

  async removeCoin(symbol: string) {
    const upper = symbol.trim().toUpperCase();
    const existing = await this.repo.findCoinBySymbol(upper);
    if (!existing) throw new NotFoundException(`Coin ${upper} not found`);
    await this.repo.removeCoin(upper);
  }

  async listReferences(pattern: string) {
    const rows = await this.repo.findReferencesByPattern(pattern);
    return rows.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      imageUrl: r.imageUrl,
      notes: r.notes ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async uploadReference(file: Express.Multer.File, pattern: string, notes?: string) {
    const date = new Date().toISOString().slice(0, 10);
    const ext = (file.originalname.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `pattern-refs/${pattern}/${date}-${Date.now()}.${ext}`;
    const stored = await this.storage.uploadFile(file, key);
    const row = await this.repo.addReference(pattern, stored.url, stored.key, notes);
    return { id: row.id, pattern: row.pattern, imageUrl: row.imageUrl, notes: row.notes ?? null, createdAt: row.createdAt.toISOString() };
  }

  async removeReference(id: string) {
    const row = await this.repo.findReferenceById(id);
    if (!row) return;
    await this.repo.removeReference(id);
    if (row.r2Key) await this.storage.deleteByKey(row.r2Key);
  }

  /** Fetch each watched coin's klines and run the selected pattern detectors on-demand. */
  async scan(patterns: PatternKind[], timeframe = '1d'): Promise<PatternScanResult> {
    const coins = await this.repo.findAllCoins();
    const results: PatternScanCoinResult[] = [];
    let scanned = 0;
    let failed = 0;

    for (const coin of coins) {
      try {
        const klines = await this.binance.fetchKlines({
          symbol: `${coin.symbol}USDT`,
          timeframe: timeframe as never,
          limit: CANDLE_LIMIT,
        });
        scanned++;
        if (klines.length < MIN_CANDLES) continue;

        const opens = klines.map((k) => parseFloat(k[1]));
        const series = {
          highs: klines.map((k) => parseFloat(k[2])),
          lows: klines.map((k) => parseFloat(k[3])),
          closes: klines.map((k) => parseFloat(k[4])),
        };
        const matches = scanChartPatterns(series, patterns);
        if (matches.length > 0) {
          const indicators: CoinIndicators = {
            rsi:   Number(calculateRsi(series.closes, 14).toFixed(1)),
            ema34:  Number(calculateEma(series.closes, 34).toFixed(6)),
            ema89:  Number(calculateEma(series.closes, 89).toFixed(6)),
            ema200: Number(calculateEma(series.closes, 200).toFixed(6)),
          };
          results.push({
            symbol: coin.symbol,
            name: coin.name,
            price: series.closes[series.closes.length - 1] ?? 0,
            opens,
            highs: series.highs,
            lows: series.lows,
            closes: series.closes,
            matches,
            indicators,
          });
        }
      } catch (err) {
        failed++;
        this.logger.warn(`scan failed for ${coin.symbol}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Confirmed patterns first, then by amplitude (most significant on top).
    results.sort((a, b) => {
      const aConf = a.matches.some((m) => m.status === 'confirmed') ? 1 : 0;
      const bConf = b.matches.some((m) => m.status === 'confirmed') ? 1 : 0;
      if (aConf !== bConf) return bConf - aConf;
      return Math.max(...b.matches.map((m) => m.heightPct)) - Math.max(...a.matches.map((m) => m.heightPct));
    });

    return {
      scannedAt: new Date().toISOString(),
      timeframe,
      patterns,
      scanned,
      failed,
      coins: results,
    };
  }
}
