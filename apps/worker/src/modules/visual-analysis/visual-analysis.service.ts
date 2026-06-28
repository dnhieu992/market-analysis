import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import type { Candle } from '@app/core';
import { extractSupportAndResistanceLevels } from '@app/core';
import { createDailyAnalysisRepository } from '@app/db';

import { ChartService } from '../chart/chart.service';
import { MarketDataService } from '../market/market-data.service';
import { detectTrend, type Trend } from '../market/utils/trend';
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

// Marker prefixed to any review note written automatically by the LLM, so the
// dashboard clearly shows the evaluation was machine-generated.
const LLM_REVIEW_MARKER = '🤖 Đánh giá tự động bởi AI';

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

    // Before producing today's plan, have the LLM review the previous day's
    // plan against what actually happened. Fully non-fatal — must never break
    // the main analysis flow.
    await this.reviewPreviousPlan(symbol);

    const now = new Date();
    const specs = getChartSpecs(now);

    const charts: Array<{ buffer: Buffer; caption: string }> = [];
    const imageBuffers: Array<{ buffer: Buffer; label: string }> = [];

    for (const spec of specs) {
      const buf = await this.generateTimeframeChart(symbol, spec);
      charts.push({ buffer: buf, caption: `${symbol} ${spec.label}` });
      imageBuffers.push({ buffer: buf, label: spec.label });
    }

    // Ground the vision prompt with a deterministic D1 trend + current price so
    // the plan stays trend-aligned and entries are anchored to the real price.
    const d1Candles = await this.marketDataService.getCandles(symbol, '1d', 200);
    const d1Trend = detectTrend(d1Candles);
    const currentPrice = d1Candles[d1Candles.length - 1]?.close ?? 0;

    const analysisText = await this.callClaudeVision(symbol, imageBuffers, now, d1Trend, currentPrice);

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

  /**
   * Reviews the previous day's plan for `symbol` and stores an LLM evaluation
   * into that record's note. Fully self-contained and non-fatal: any failure is
   * logged and swallowed so today's analysis is never blocked.
   */
  private async reviewPreviousPlan(symbol: string): Promise<void> {
    try {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const previous = await this.dailyAnalysisRepository.findLatestBefore(symbol, today);
      if (!previous) {
        this.logger.log(`No previous daily plan to review for ${symbol} — skipping review`);
        return;
      }

      // Never clobber an existing note (manual feedback or an earlier review).
      if (previous.feedbackNote && previous.feedbackNote.trim().length > 0) {
        this.logger.log(`Previous plan for ${symbol} already has a note — skipping review`);
        return;
      }

      const planDate = new Date(previous.date);
      const planDateStr = planDate.toISOString().slice(0, 10);

      // Fetch recent daily candles to judge how price actually behaved since.
      const candles = await this.marketDataService.getCandles(symbol, '1d', 14);
      const outcomeCandles = candles.filter(c => (c.openTime?.getTime() ?? 0) >= planDate.getTime());
      const relevant = outcomeCandles.length > 0 ? outcomeCandles : candles.slice(-5);

      const priceLines = relevant
        .map(c => {
          const d = c.openTime ? c.openTime.toISOString().slice(0, 10) : '?';
          return `${d}: O=${c.open} H=${c.high} L=${c.low} C=${c.close}`;
        })
        .join('\n');
      const currentPrice = candles[candles.length - 1]?.close ?? 0;

      const reviewText = await this.callClaudeReview(
        symbol,
        planDateStr,
        previous.summary ?? '',
        priceLines,
        currentPrice
      );

      if (!reviewText) {
        this.logger.warn(`Empty review from Claude for ${symbol} — skipping note save`);
        return;
      }

      const note = [
        `${LLM_REVIEW_MARKER} — ${new Date().toISOString().slice(0, 10)}`,
        '',
        reviewText.trim()
      ].join('\n');

      await this.dailyAnalysisRepository.updateReviewNote(previous.id, note);
      this.logger.log(`Saved LLM review note for ${symbol} (plan date ${planDateStr})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Previous-plan review failed for ${symbol} (non-fatal): ${msg}`);
    }
  }

  private async callClaudeReview(
    symbol: string,
    planDateStr: string,
    planText: string,
    priceLines: string,
    currentPrice: number
  ): Promise<string | null> {
    const response = await this.httpClient.post<ClaudeMessagesResponse>('/v1/messages', {
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Bạn là chuyên gia phân tích kỹ thuật. Hãy ĐÁNH GIÁ độ chính xác của bản phân tích & plan giao dịch ${symbol} đã đưa ra ngày ${planDateStr}, dựa trên diễn biến giá thực tế sau đó.`,
                '',
                '=== PHÂN TÍCH & PLAN NGÀY TRƯỚC ===',
                planText || '(không có nội dung)',
                '',
                '=== DIỄN BIẾN GIÁ THỰC TẾ (nến ngày D1 sau đó) ===',
                priceLines || '(không có dữ liệu)',
                `Giá hiện tại: ${currentPrice}`,
                '',
                'Yêu cầu đánh giá (trả lời bằng tiếng Việt, ngắn gọn, có cấu trúc):',
                '- Nhận định xu hướng/bias trong plan có ĐÚNG so với thực tế không?',
                '- Các vùng entry / SL / TP có bị chạm hay không? Plan thắng/thua/chưa kích hoạt?',
                '- Điểm đúng và điểm sai của phân tích.',
                '- Bài học rút ra cho lần sau.'
              ].join('\n')
            }
          ]
        }
      ]
    });

    return response.data.content?.find(b => b.type === 'text')?.text ?? null;
  }

  private trendVi(trend: Trend): string {
    if (trend === 'bullish') return 'TĂNG';
    if (trend === 'bearish') return 'GIẢM';
    return 'ĐI NGANG';
  }

  private async callClaudeVision(
    symbol: string,
    images: Array<{ buffer: Buffer; label: string }>,
    date: Date,
    d1Trend: Trend = 'neutral',
    currentPrice = 0
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
                `BỐI CẢNH (đã tính sẵn, dùng làm chuẩn): Xu hướng D1 = ${this.trendVi(d1Trend)}. Giá hiện tại ≈ ${currentPrice}.`,
                '',
                'QUY TẮC BẮT BUỘC khi ra plan (tuân thủ tuyệt đối — vi phạm sẽ bị loại bỏ tự động):',
                '1. THUẬN XU HƯỚNG: chỉ đề xuất lệnh CÙNG chiều xu hướng D1. D1 GIẢM → chỉ SHORT, TUYỆT ĐỐI không bắt đáy LONG. D1 TĂNG → chỉ LONG, không bán đỉnh SHORT. D1 ĐI NGANG → được cả hai nhưng chỉ tại biên range rõ ràng.',
                '2. ENTRY GẦN GIÁ: entry phải nằm trong khoảng ~3% quanh giá hiện tại, hoặc ngay tại điểm phá vỡ/retest sắp diễn ra. KHÔNG đặt entry chờ một nhịp hồi sâu mà thị trường nhiều khả năng không chạm tới — đó chính là lý do lệnh "treo" không bao giờ khớp.',
                '3. R:R TỐI THIỂU 1.5 (ưu tiên ≥ 2): khoảng cách Entry→TP1 phải ≥ 1.5 lần khoảng cách Entry→SL. Nếu không đạt thì KHÔNG đưa lệnh đó.',
                '4. ĐƯỢC PHÉP KHÔNG GIAO DỊCH: nếu thị trường đi ngang/nhiễu/đang quá mở rộng hoặc tín hiệu mâu thuẫn → ghi rõ "KHÔNG VÀO LỆNH HÔM NAY" kèm lý do, KHÔNG bịa setup cho đủ.',
                '',
                'Phân tích từ khung lớn xuống nhỏ, xác định xu hướng tổng thể, rồi đưa ra trading plan cụ thể cho hôm nay (entry, SL, TP1, TP2, trigger, invalidation) — hoặc kết luận không giao dịch. Mỗi setup phải ghi rõ R:R.'
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
