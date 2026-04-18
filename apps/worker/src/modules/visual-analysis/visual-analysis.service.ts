import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import type { Candle } from '@app/core';
import { extractSupportAndResistanceLevels } from '@app/core';
import { createDailyAnalysisRepository } from '@app/db';

import { ChartService } from '../chart/chart.service';
import { MarketDataService } from '../market/market-data.service';
import type { OhlcCandle } from '../chart/chart.types';

type DailyAnalysisRepository = ReturnType<typeof createDailyAnalysisRepository>;

export type VisualAnalysisResult = {
  symbol: string;
  analysisText: string;
  chartBuffer: Buffer;
};

type ClaudeMessagesResponse = {
  content?: Array<{ type: string; text?: string }>;
};

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CANDLE_LIMIT = 200; // fetch 200, render last 150
const CHART_CANDLES = 150;

function toOhlcCandle(candle: Candle): OhlcCandle {
  return {
    time: candle.openTime?.getTime() ?? 0,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close
  };
}

function computeEmaSeries(closes: number[], period: number): number[] {
  const smoothing = 2 / (period + 1);
  const result: number[] = [];
  let ema = 0;

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    if (i === period - 1) {
      ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    } else {
      ema = closes[i]! * smoothing + ema * (1 - smoothing);
    }
    result.push(Number(ema.toFixed(6)));
  }

  return result;
}

@Injectable()
export class VisualAnalysisService {
  private readonly logger = new Logger(VisualAnalysisService.name);
  private readonly httpClient: AxiosInstance;
  private readonly dailyAnalysisRepository: DailyAnalysisRepository;

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly chartService: ChartService,
    @Optional() httpClient?: AxiosInstance
  ) {
    this.dailyAnalysisRepository = createDailyAnalysisRepository();
    this.httpClient =
      httpClient ??
      axios.create({
        baseURL: 'https://api.anthropic.com',
        timeout: 90_000,
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });
  }

  async analyze(symbol: string): Promise<VisualAnalysisResult> {
    this.logger.log(`Starting visual analysis for ${symbol}`);

    const candles = await this.marketDataService.getCandles(symbol, '4h', CANDLE_LIMIT);
    const chartCandles = candles.slice(-CHART_CANDLES);

    const closes = candles.map(c => c.close);
    const ema20Full = computeEmaSeries(closes, 20);
    const ema50Full = computeEmaSeries(closes, 50);
    const ema200Full = computeEmaSeries(closes, 200);

    const startIdx = candles.length - CHART_CANDLES;
    const ema20 = ema20Full.slice(startIdx);
    const ema50 = ema50Full.slice(startIdx);
    const ema200 = ema200Full.slice(startIdx);

    const { supportLevels, resistanceLevels } = extractSupportAndResistanceLevels(chartCandles, 2);
    const currentPrice = chartCandles[chartCandles.length - 1]?.close ?? 0;

    const { imageBuffer } = await this.chartService.generateChartImage({
      symbol,
      timeframe: 'H4',
      candles: chartCandles.map(toOhlcCandle),
      ema20,
      ema50,
      ema200,
      supportLevels: supportLevels.filter(isFinite),
      resistanceLevels: resistanceLevels.filter(isFinite),
      currentPrice
    });

    const analysisText = await this.callClaudeVision(symbol, imageBuffer);

    await this.saveToDatabase(symbol, analysisText);

    this.logger.log(`Visual analysis complete for ${symbol}`);

    return { symbol, analysisText, chartBuffer: imageBuffer };
  }

  private async saveToDatabase(symbol: string, analysisText: string): Promise<void> {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);

    try {
      const existing = await this.dailyAnalysisRepository.findByDate(symbol, date);
      if (existing) {
        this.logger.log(`Daily analysis for ${symbol} already exists for today — skipping DB save`);
        return;
      }

      await this.dailyAnalysisRepository.create({
        symbol,
        date,
        status: 'PUBLISHED',
        llmProvider: 'claude',
        llmModel: CLAUDE_MODEL,
        aiOutputJson: JSON.stringify({ analysisText }),
        summary: analysisText
      });

      this.logger.log(`Daily analysis saved to DB for ${symbol}`);
    } catch (error) {
      this.logger.error(`Failed to save daily analysis for ${symbol}: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  private async callClaudeVision(symbol: string, imageBuffer: Buffer): Promise<string> {
    const base64Image = imageBuffer.toString('base64');
    const apiKey = process.env.CLAUDE_API_KEY ?? '';
    this.logger.log(`Calling Claude Vision for ${symbol} — key: ${apiKey ? apiKey.slice(0, 12) + '...' : 'MISSING'}`);

    const response = await this.httpClient.post<ClaudeMessagesResponse>('/v1/messages', {
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image
              }
            },
            {
              type: 'text',
              text: `Phân tích ${symbol} và cho plan giao dịch hôm nay`
            }
          ]
        }
      ]
    });

    const text = response.data.content?.find(b => b.type === 'text')?.text;

    if (!text) {
      throw new Error(`Empty response from Claude Vision for ${symbol}`);
    }

    return text;
  }
}
