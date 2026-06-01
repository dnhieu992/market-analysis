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
  charts: Array<{ buffer: Buffer; caption: string }>;
};

type ClaudeMessagesResponse = {
  content?: Array<{ type: string; text?: string }>;
};

type ChartSpec = {
  timeframe: string;
  label: string;
  candleLimit: number;
  displayCandles: number;
};

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

function getChartSpecs(date: Date): ChartSpec[] {
  const specs: ChartSpec[] = [];

  if (date.getUTCDate() === 1) {
    specs.push({ timeframe: '1M', label: 'MN', candleLimit: 48, displayCandles: 36 });
  }

  if (date.getUTCDay() === 1) {
    specs.push({ timeframe: '1w', label: 'W1', candleLimit: 100, displayCandles: 60 });
  }

  specs.push({ timeframe: '1d', label: 'D1', candleLimit: 200, displayCandles: 150 });
  specs.push({ timeframe: '4h', label: 'H4', candleLimit: 200, displayCandles: 150 });

  return specs;
}

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

    const now = new Date();
    const specs = getChartSpecs(now);

    const charts: Array<{ buffer: Buffer; caption: string }> = [];
    const imageBuffers: Array<{ buffer: Buffer; label: string }> = [];

    for (const spec of specs) {
      const buf = await this.generateTimeframeChart(symbol, spec);
      charts.push({ buffer: buf, caption: `${symbol} ${spec.label}` });
      imageBuffers.push({ buffer: buf, label: spec.label });
    }

    const analysisText = await this.callClaudeVision(symbol, imageBuffers, now);

    await this.saveToDatabase(symbol, analysisText);

    this.logger.log(`Visual analysis complete for ${symbol}`);

    return { symbol, analysisText, charts };
  }

  private async generateTimeframeChart(symbol: string, spec: ChartSpec): Promise<Buffer> {
    const candles = await this.marketDataService.getCandles(
      symbol,
      spec.timeframe as Parameters<typeof this.marketDataService.getCandles>[1],
      spec.candleLimit
    );
    const displayCandles = candles.slice(-spec.displayCandles);

    const closes = candles.map(c => c.close);
    const ema20Full = computeEmaSeries(closes, 20);
    const ema50Full = computeEmaSeries(closes, 50);
    const ema200Full = computeEmaSeries(closes, 200);

    const startIdx = candles.length - spec.displayCandles;
    const ema20 = ema20Full.slice(startIdx);
    const ema50 = ema50Full.slice(startIdx);
    const ema200 = ema200Full.slice(startIdx);

    const { supportLevels, resistanceLevels } = extractSupportAndResistanceLevels(displayCandles, 2);
    const currentPrice = displayCandles[displayCandles.length - 1]?.close ?? 0;

    const { imageBuffer } = await this.chartService.generateChartImage({
      symbol,
      timeframe: spec.label,
      candles: displayCandles.map(toOhlcCandle),
      ema20,
      ema50,
      ema200,
      supportLevels: supportLevels.filter(isFinite),
      resistanceLevels: resistanceLevels.filter(isFinite),
      currentPrice
    });

    return imageBuffer;
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
      this.logger.error(
        `Failed to save daily analysis for ${symbol}: ${error instanceof Error ? error.message : 'unknown'}`
      );
    }
  }

  private async callClaudeVision(
    symbol: string,
    images: Array<{ buffer: Buffer; label: string }>,
    date: Date
  ): Promise<string> {
    const dateStr = date.toISOString().slice(0, 10);
    const apiKey = process.env.CLAUDE_API_KEY ?? '';
    this.logger.log(`Calling Claude Vision for ${symbol} (${images.length} charts) — key: ${apiKey || 'MISSING'}`);

    const chartList = images
      .map((img, i) => `- Biểu đồ ${i + 1}: Khung ${img.label}`)
      .join('\n');

    const imageBlocks = images.map(img => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: img.buffer.toString('base64')
      }
    }));

    const response = await this.httpClient.post<ClaudeMessagesResponse>('/v1/messages', {
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: [
                `Phân tích đa khung thời gian ${symbol} — ${dateStr}`,
                '',
                'Biểu đồ đính kèm theo thứ tự từ khung lớn đến nhỏ:',
                chartList,
                '',
                'Phân tích từ khung lớn xuống nhỏ, xác định xu hướng tổng thể rồi đưa ra trading plan cụ thể cho hôm nay (entry, SL, TP, trigger, invalidation).'
              ].join('\n')
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
