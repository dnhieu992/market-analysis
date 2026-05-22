import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { calcUtBotResult } from '@app/core';
import { createSettingsRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { SETTINGS_REPOSITORY } from '../database/database.providers';

type SettingsRepository = ReturnType<typeof createSettingsRepository>;

export type ScanResult = {
  symbol: string;
  trend: 'uptrend' | 'downtrend';
  price: number;
  stopLevel: number;
  error?: string;
};

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    @Inject(SETTINGS_REPOSITORY)
    private readonly settingsRepository: SettingsRepository,
    private readonly marketDataService: MarketDataService
  ) {}

  async getWatchlist(): Promise<string[]> {
    const settings = await this.settingsRepository.findFirst();
    if (!settings) return [];
    return Array.isArray(settings.utbotWatchlist) ? (settings.utbotWatchlist as string[]) : [];
  }

  async updateWatchlist(symbols: string[]): Promise<string[]> {
    const upper = symbols.map((s) => s.toUpperCase());
    await this.settingsRepository.upsertUtbotWatchlist(upper as Prisma.InputJsonValue);
    return upper;
  }

  async scan(symbols: string[], timeframe: '1d' | '4h' | '1w' = '1d'): Promise<ScanResult[]> {
    const results = await Promise.all(
      symbols.map(async (symbol): Promise<ScanResult> => {
        try {
          const candles = await this.marketDataService.getCandles(symbol, timeframe, 500);
          const result = calcUtBotResult(candles);
          if (!result) {
            return { symbol, trend: 'downtrend', price: 0, stopLevel: 0, error: 'Not enough candles' };
          }
          return {
            symbol,
            trend: result.uptrend ? 'uptrend' : 'downtrend',
            price: result.price,
            stopLevel: result.stopLevel
          };
        } catch (err) {
          this.logger.warn(`Failed to scan ${symbol}: ${String(err)}`);
          return { symbol, trend: 'downtrend', price: 0, stopLevel: 0, error: 'Fetch failed' };
        }
      })
    );
    return results;
  }
}
