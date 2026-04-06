import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Candle } from '@app/core';
import { createSettingsRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';
import { detectTrend, findNearestSwingLows, findNearestSwingHighs } from '../market/utils/trend';
import type { Trend } from '../market/utils/trend';

type TimeframeAnalysis = {
  trend: Trend;
  s1: number;
  s2: number;
  r1: number;
  r2: number;
};

function analyzeTimeframe(candles: Candle[]): TimeframeAnalysis {
  const close = candles[candles.length - 1]?.close ?? 0;
  const trend = detectTrend(candles);
  const supports = findNearestSwingLows(candles, close, 2);
  const resistances = findNearestSwingHighs(candles, close, 2);

  return {
    trend,
    s1: supports[0] ?? NaN,
    s2: supports[1] ?? NaN,
    r1: resistances[0] ?? NaN,
    r2: resistances[1] ?? NaN
  };
}

function classifyVolume(candles: Candle[]): 'High' | 'Medium' | 'Low' {
  if (candles.length < 2) return 'Medium';
  const lastVolume = candles[candles.length - 1]?.volume ?? 0;
  const previous = candles.slice(0, -1).slice(-20);
  const avg = previous.reduce((sum, c) => sum + (c.volume ?? 0), 0) / previous.length;
  if (avg === 0) return 'Medium';
  const ratio = lastVolume / avg;
  if (ratio > 1.5) return 'High';
  if (ratio >= 0.75) return 'Medium';
  return 'Low';
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function buildMessage(
  symbol: string,
  d1: TimeframeAnalysis,
  h4: TimeframeAnalysis,
  h1: TimeframeAnalysis,
  volume: 'High' | 'Medium' | 'Low'
): string {
  const label = (t: Trend) => t.charAt(0).toUpperCase() + t.slice(1);

  return [
    `📊 ${symbol} — H4 Update`,
    '',
    `D1 Trend: ${label(d1.trend)}`,
    `H4 Trend: ${label(h4.trend)}`,
    `H1 Trend: ${label(h1.trend)}`,
    '',
    `Volume: ${volume}`,
    '',
    'D1 Levels:',
    `  R2: ${fmt(d1.r2)} | R1: ${fmt(d1.r1)}`,
    `  S1: ${fmt(d1.s1)} | S2: ${fmt(d1.s2)}`,
    '',
    'H4 Levels:',
    `  R2: ${fmt(h4.r2)} | R1: ${fmt(h4.r1)}`,
    `  S1: ${fmt(h4.s1)} | S2: ${fmt(h4.s2)}`,
    '',
    'H1 Levels:',
    `  R2: ${fmt(h1.r2)} | R1: ${fmt(h1.r1)}`,
    `  S1: ${fmt(h1.s1)} | S2: ${fmt(h1.s2)}`
  ].join('\n');
}

@Injectable()
export class MarketSummaryService implements OnModuleInit {
  private readonly logger = new Logger(MarketSummaryService.name);
  private readonly lastSentH4CloseTime = new Map<string, number>();
  private readonly settingsRepository = createSettingsRepository();

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.checkH4Closes();
  }

  @Cron('*/15 * * * *')
  async checkH4Closes(): Promise<void> {
    let symbols: string[];
    try {
      const settings = await this.settingsRepository.findFirst();
      symbols = (settings?.trackingSymbols as string[] | null) ?? [];
    } catch (error) {
      this.logger.error('Failed to read settings', error);
      return;
    }

    if (symbols.length === 0) return;

    for (const symbol of symbols) {
      try {
        await this.processSymbol(symbol);
      } catch (error) {
        this.logger.error(`Failed to process symbol ${symbol}`, error);
      }
    }
  }

  private async processSymbol(symbol: string): Promise<void> {
    const h4Candles = await this.marketDataService.getCandles(symbol, '4h', 2);
    if (h4Candles.length < 2) return;

    const closedCandle = h4Candles[h4Candles.length - 2];
    const closeTime = closedCandle?.closeTime?.getTime() ?? 0;
    if (closeTime === 0) return;

    if (this.lastSentH4CloseTime.get(symbol) === closeTime) return;

    const [d1Candles, h4Full, h1Candles] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1d', 100),
      this.marketDataService.getCandles(symbol, '4h', 100),
      this.marketDataService.getCandles(symbol, '1h', 100)
    ]);

    const d1 = analyzeTimeframe(d1Candles);
    const h4 = analyzeTimeframe(h4Full);
    const h1 = analyzeTimeframe(h1Candles);
    const volume = classifyVolume(h4Full);

    const message = buildMessage(symbol, d1, h4, h1, volume);

    const result = await this.telegramService.sendAnalysisMessage({
      content: message,
      messageType: 'h4-summary'
    });

    if (result.success) {
      this.lastSentH4CloseTime.set(symbol, closeTime);
      this.logger.log(`H4 summary sent for ${symbol}`);
    }
  }
}
