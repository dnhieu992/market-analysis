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

/** Per-source point breakdown so the UI can explain how the score was reached. */
export type PatternSignalBreakdown = {
  rsiBull: number;
  rsiBear: number;
  emaBull: number;
  emaBear: number;
  patternBull: number;
  patternBear: number;
};

/**
 * Weighted bull/bear score for a scanned coin, split into a tăng/giảm percentage.
 * See `computeSignal` for the scoring rules (mirrored in the UI's info dialog).
 */
export type PatternSignal = {
  bullPoints: number;
  bearPoints: number;
  /** Integer share 0–100; bullPct + bearPct = 100 whenever there is at least one point. */
  bullPct: number;
  bearPct: number;
  breakdown: PatternSignalBreakdown;
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
  signal: PatternSignal;
};

/**
 * Score a coin's bullish vs bearish bias from RSI, Sonic-R EMA alignment and the
 * matched chart patterns, then split into a tăng/giảm %. Rules:
 *   • RSI < 30 → +1 bull · RSI > 70 → +1 bear
 *   • EMA (highest matching tier only):
 *       price > EMA34 → +1 · > EMA34 > EMA89 → +2 · > EMA34 > EMA89 > EMA200 → +3 (bull)
 *       the mirror ordering (price < EMA34 < EMA89 < EMA200) scores the same for bear
 *   • each double-bottom / inverse-H&S → +1 bull · each double-top / H&S → +1 bear
 */
export function computeSignal(price: number, ind: CoinIndicators, matches: PatternMatch[]): PatternSignal {
  const rsiBull = ind.rsi < 30 ? 1 : 0;
  const rsiBear = ind.rsi > 70 ? 1 : 0;

  const { ema34, ema89, ema200 } = ind;
  let emaBull = 0;
  if (price > ema34 && ema34 > ema89 && ema89 > ema200) emaBull = 3;
  else if (price > ema34 && ema34 > ema89) emaBull = 2;
  else if (price > ema34) emaBull = 1;
  let emaBear = 0;
  if (price < ema34 && ema34 < ema89 && ema89 < ema200) emaBear = 3;
  else if (price < ema34 && ema34 < ema89) emaBear = 2;
  else if (price < ema34) emaBear = 1;

  let patternBull = 0;
  let patternBear = 0;
  for (const m of matches) {
    if (m.pattern === 'double_bottom' || m.pattern === 'inverse_head_shoulders') patternBull += 1;
    else if (m.pattern === 'double_top' || m.pattern === 'head_shoulders') patternBear += 1;
  }

  const bullPoints = rsiBull + emaBull + patternBull;
  const bearPoints = rsiBear + emaBear + patternBear;
  const total = bullPoints + bearPoints;
  const bullPct = total > 0 ? Math.round((bullPoints / total) * 100) : 0;
  const bearPct = total > 0 ? 100 - bullPct : 0;

  return {
    bullPoints,
    bearPoints,
    bullPct,
    bearPct,
    breakdown: { rsiBull, rsiBear, emaBull, emaBear, patternBull, patternBear },
  };
}

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
          const price = series.closes[series.closes.length - 1] ?? 0;
          results.push({
            symbol: coin.symbol,
            name: coin.name,
            price,
            opens,
            highs: series.highs,
            lows: series.lows,
            closes: series.closes,
            matches,
            indicators,
            signal: computeSignal(price, indicators, matches),
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
