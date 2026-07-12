import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { scanChartPatterns } from '@app/core';
import type { PatternKind, PatternMatch } from '@app/core';
import { createPatternScannerRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';

const CANDLE_LIMIT = 300;
const MIN_CANDLES = 60;

export type PatternScanCoinResult = {
  symbol: string;
  name: string;
  price: number;
  /** Close series used for the scan (oldest → newest); pivot `idx` index into this. Lets the UI draw the pattern. */
  closes: number[];
  matches: PatternMatch[];
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

  constructor(private readonly binance: BinanceMarketDataService) {}

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

        const series = {
          highs: klines.map((k) => parseFloat(k[2])),
          lows: klines.map((k) => parseFloat(k[3])),
          closes: klines.map((k) => parseFloat(k[4])),
        };
        const matches = scanChartPatterns(series, patterns);
        if (matches.length > 0) {
          results.push({
            symbol: coin.symbol,
            name: coin.name,
            price: series.closes[series.closes.length - 1] ?? 0,
            closes: series.closes,
            matches,
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
