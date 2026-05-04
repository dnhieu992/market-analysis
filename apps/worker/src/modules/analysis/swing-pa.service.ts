import { Injectable, Logger } from '@nestjs/common';
import type { AnalysisTimeframe } from '@app/config';
import type { Candle } from '@app/core';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';
import { analyzeSwingPa } from './swing-pa-analyzer';
import { formatSwingPaMessage, formatClaudeReviewMessage } from './swing-pa-formatter';
import { renderSwingPaChart } from './swing-pa-chart';
import { SwingPaReviewService } from './swing-pa-review.service';

export type SwingPaResult = {
  text: string;
  reviewText: string | null;
  chartBuffer: Buffer;
};

@Injectable()
export class SwingPaService {
  private readonly logger = new Logger(SwingPaService.name);

  constructor(
    private readonly marketData: MarketDataService,
    private readonly telegramService: TelegramService,
    private readonly reviewService: SwingPaReviewService
  ) {}

  async analyze(symbol: string): Promise<SwingPaResult> {
    this.logger.log(`Swing PA analysis: ${symbol}`);

    const [dailyCandles, weeklyCandles, h4Candles] = await Promise.all([
      this.marketData.getCandles(symbol, '1d' as AnalysisTimeframe, 60),
      this.marketData.getCandles(symbol, '1w' as AnalysisTimeframe, 52),
      this.marketData.getCandles(symbol, '4h' as AnalysisTimeframe, 100),
    ]);

    const analysis = analyzeSwingPa(symbol, dailyCandles, weeklyCandles, h4Candles);

    const [chartBuffer, review] = await Promise.all([
      renderSwingPaChart(analysis, dailyCandles as Candle[]),
      this.reviewService.review(analysis, dailyCandles as Candle[])
    ]);

    const text       = formatSwingPaMessage(analysis);
    const reviewText = review ? formatClaudeReviewMessage(review) : null;

    return { text, reviewText, chartBuffer };
  }

  async analyzeAndSend(symbol: string, chatId: string): Promise<void> {
    this.logger.log(`[env] TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.slice(0, 10) + '...' : 'MISSING'}`);
    this.logger.log(`[env] TELEGRAM_CHAT_ID: ${process.env.TELEGRAM_CHAT_ID ?? 'MISSING'} | chatId param: ${chatId}`);
    const { text, reviewText, chartBuffer } = await this.analyze(symbol);

    await this.telegramService.sendToChat(chatId, text);
    await this.telegramService.sendPhotoToChat(chatId, chartBuffer, `${symbol} Daily — Pure PA Swing`);
    if (reviewText) {
      await this.telegramService.sendToChat(chatId, reviewText);
    }
  }
}
