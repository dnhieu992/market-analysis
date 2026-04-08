import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  buildIndicatorSnapshot,
  formatDailyAnalysisPlanMessage,
  type DailyAnalysisMarketData,
  type Candle,
  type DailyAnalysisPlan
} from '@app/core';
import { createDailyAnalysisRepository } from '@app/db';

import { buildDailyAnalysisMarketData } from './daily-analysis-market-data.builder';
import { publishDailyAnalysisPlan } from './publish-daily-analysis-plan';
import { MarketDataService } from '../market/market-data.service';
import { detectTrend, findNearestSwingLows, findNearestSwingHighs } from '../market/utils/trend';
import type { Trend } from '../market/utils/trend';
import { LlmGatewayService } from '../llm/llm-gateway.service';

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
  status: DailyAnalysisPlan['status'];
  d1: TimeframeAnalysis;
  h4: TimeframeAnalysis;
  h4Indicators: {
    ema20: number;
    ema50: number;
    ema200: number;
    rsi14: number;
    macd: {
      macd: number;
      signal: number;
      histogram: number;
    };
    atr14: number;
    volumeRatio: number;
  };
  llmProvider: string;
  llmModel: string;
  marketData: DailyAnalysisMarketData;
  aiOutput: DailyAnalysisPlan;
  pipelineDebugJson: string;
  summary: string;
};

type DailyAnalysisRepository = ReturnType<typeof createDailyAnalysisRepository>;

type DailyAnalysisPipelineOutput = Awaited<
  ReturnType<LlmGatewayService['runDailyAnalysisPipeline']>
>;

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

@Injectable()
export class DailyAnalysisService {
  private readonly logger = new Logger(DailyAnalysisService.name);

  constructor(
    private readonly marketDataService: MarketDataService,
    @Optional()
    private readonly dailyAnalysisRepository: DailyAnalysisRepository = createDailyAnalysisRepository(),
    @Optional()
    @Inject(LlmGatewayService)
    private readonly llmGatewayService?: LlmGatewayService
  ) {}

  async analyze(symbol: string): Promise<DailyAnalysisResult> {
    const [d1Candles, h4Candles] = await Promise.all([
      this.marketDataService.getCandles(symbol, '1d', 200),
      this.marketDataService.getCandles(symbol, '4h', 200)
    ]);

    const d1 = analyzeTimeframe(d1Candles);
    const h4 = analyzeTimeframe(h4Candles);
    const h4Snapshot = buildIndicatorSnapshot(h4Candles);
    const currentPrice = h4Candles[h4Candles.length - 1]?.close ?? 0;

    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);

    const h4Indicators = {
      ema20: h4Snapshot.ema20,
      ema50: h4Snapshot.ema50,
      ema200: h4Snapshot.ema200,
      rsi14: h4Snapshot.rsi14,
      macd: h4Snapshot.macd,
      atr14: h4Snapshot.atr14,
      volumeRatio: h4Snapshot.volumeRatio
    };
    const marketData = buildDailyAnalysisMarketData({
      symbol,
      date,
      currentPrice,
      d1Candles,
      h4Candles,
      d1,
      h4,
      h4Indicators: h4Snapshot
    });

    const pipelineResult = await this.generateAiPlan(marketData);
    const published = publishDailyAnalysisPlan({
      marketData,
      analystDraft: pipelineResult.draftPlan,
      validatorResult: pipelineResult.validatorResult
    });
    const summary = formatDailyAnalysisPlanMessage({
      symbol,
      date,
      marketData,
      plan: published.plan
    });

    return {
      symbol,
      date,
      status: published.plan.status,
      d1,
      h4,
      h4Indicators,
      marketData,
      llmProvider: pipelineResult.provider,
      llmModel: pipelineResult.model,
      aiOutput: published.plan,
      pipelineDebugJson: JSON.stringify(published.debug),
      summary
    };
  }

  async analyzeAndSave(
    symbol: string
  ): Promise<{ skipped: boolean; result: DailyAnalysisResult }> {
    const result = await this.analyze(symbol);

    let existing;
    try {
      existing = await this.dailyAnalysisRepository.findByDate(symbol, result.date);
    } catch (error) {
      this.logger.error(`Failed to check existing daily analysis for ${symbol}`, error);
      throw error;
    }

    if (existing) {
      this.logger.log(
        `Daily analysis for ${symbol} on ${result.date.toISOString().slice(0, 10)} already exists, skipping`
      );
      return { skipped: true, result };
    }

    try {
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
        status: result.status,
        llmProvider: result.llmProvider,
        llmModel: result.llmModel,
        aiOutputJson: JSON.stringify(result.aiOutput),
        pipelineDebugJson: result.pipelineDebugJson,
        summary: result.summary
      });
    } catch (error) {
      this.logger.error(`Failed to save daily analysis for ${symbol}`, error);
      throw error;
    }

    this.logger.log(`Daily analysis saved for ${symbol}`);
    return { skipped: false, result };
  }

  private async generateAiPlan(
    marketData: DailyAnalysisMarketData
  ): Promise<DailyAnalysisPipelineOutput> {
    if (!this.llmGatewayService) {
      throw new Error('LLM gateway service is not configured');
    }

    return this.llmGatewayService.runDailyAnalysisPipeline(marketData);
  }
}
