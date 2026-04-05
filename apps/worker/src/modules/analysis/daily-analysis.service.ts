import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Candle } from '@app/core';
import { createDailyAnalysisRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { detectTrend, findNearestSwingLows, findNearestSwingHighs } from '../market/utils/trend';
import type { Trend } from '../market/utils/trend';

type TimeframeAnalysis = {
  trend: Trend;
  s1: number;
  s2: number;
  r1: number;
  r2: number;
};

export type DailyAnalysisResult = {
  symbol: string;
  date: Date;
  d1: TimeframeAnalysis;
  h4: TimeframeAnalysis;
  summary: string;
};

type DailyAnalysisRepository = ReturnType<typeof createDailyAnalysisRepository>;

function analyzeTimeframe(candles: Candle[]): TimeframeAnalysis {
  const close = candles[candles.length - 1]?.close ?? 0;
  const trend = detectTrend(candles);
  const supports = findNearestSwingLows(candles, close, 2);
  const resistances = findNearestSwingHighs(candles, close, 2);

  return {
    trend,
    s1: supports[0] ?? 0,
    s2: supports[1] ?? 0,
    r1: resistances[0] ?? 0,
    r2: resistances[1] ?? 0
  };
}

function fmt(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function buildSummary(
  symbol: string,
  date: Date,
  d1: TimeframeAnalysis,
  h4: TimeframeAnalysis
): string {
  const dateStr = date.toISOString().slice(0, 10);
  const label = (t: Trend) => t.charAt(0).toUpperCase() + t.slice(1);

  return [
    `📅 ${symbol} Daily Plan — ${dateStr}`,
    '',
    `D1 Trend: ${label(d1.trend)}`,
    `H4 Trend: ${label(h4.trend)}`,
    '',
    'D1 Levels:',
    `  R2: ${fmt(d1.r2)} | R1: ${fmt(d1.r1)}`,
    `  S1: ${fmt(d1.s1)} | S2: ${fmt(d1.s2)}`,
    '',
    'H4 Levels:',
    `  R2: ${fmt(h4.r2)} | R1: ${fmt(h4.r1)}`,
    `  S1: ${fmt(h4.s1)} | S2: ${fmt(h4.s2)}`,
    '',
    `If price breaks D1 S1 (${fmt(d1.s1)}) → next target S2 (${fmt(d1.s2)})`,
    `If price breaks D1 R1 (${fmt(d1.r1)}) → next target R2 (${fmt(d1.r2)})`,
    `If price breaks H4 S1 (${fmt(h4.s1)}) → next target S2 (${fmt(h4.s2)})`,
    `If price breaks H4 R1 (${fmt(h4.r1)}) → next target R2 (${fmt(h4.r2)})`
  ].join('\n');
}

@Injectable()
export class DailyAnalysisService {
  private readonly logger = new Logger(DailyAnalysisService.name);

  constructor(
    private readonly marketDataService: MarketDataService,
    @Optional()
    private readonly dailyAnalysisRepository: DailyAnalysisRepository = createDailyAnalysisRepository()
  ) {}

  async analyze(symbol: string): Promise<DailyAnalysisResult> {
    const [d1Candles, h4Candles] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1d', 100),
      this.marketDataService.getCandles(symbol, '4h', 100)
    ]);

    const d1 = analyzeTimeframe(d1Candles);
    const h4 = analyzeTimeframe(h4Candles);

    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);

    const summary = buildSummary(symbol, date, d1, h4);

    return { symbol, date, d1, h4, summary };
  }

  async analyzeAndSave(
    symbol: string
  ): Promise<{ skipped: boolean; result: DailyAnalysisResult }> {
    const result = await this.analyze(symbol);

    const existing = await this.dailyAnalysisRepository.findByDate(symbol, result.date);

    if (existing) {
      this.logger.log(
        `Daily analysis for ${symbol} on ${result.date.toISOString().slice(0, 10)} already exists, skipping`
      );
      return { skipped: true, result };
    }

    await this.dailyAnalysisRepository.create({
      symbol: result.symbol,
      date: result.date,
      d1Trend: result.d1.trend,
      h4Trend: result.h4.trend,
      d1S1: result.d1.s1,
      d1S2: result.d1.s2,
      d1R1: result.d1.r1,
      d1R2: result.d1.r2,
      h4S1: result.h4.s1,
      h4S2: result.h4.s2,
      h4R1: result.h4.r1,
      h4R2: result.h4.r2,
      summary: result.summary
    });

    this.logger.log(`Daily analysis saved for ${symbol}`);
    return { skipped: false, result };
  }
}
