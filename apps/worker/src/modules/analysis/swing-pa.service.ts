import { Injectable, Logger } from '@nestjs/common';
import type { AnalysisTimeframe } from '@app/config';
import type { Candle } from '@app/core';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';
import { analyzeSwingPa } from './swing-pa-analyzer';
import { formatSwingPaMessage } from './swing-pa-formatter';
import { renderSwingPaChart } from './swing-pa-chart';

export type SwingPaResult = {
  text: string;
  chartBuffer: Buffer;
};

@Injectable()
export class SwingPaService {
  private readonly logger = new Logger(SwingPaService.name);

  constructor(
    private readonly marketData: MarketDataService,
    private readonly telegramService: TelegramService
  ) {}

  async analyze(symbol: string): Promise<SwingPaResult> {
    this.logger.log(`Swing PA analysis: ${symbol}`);

    const [dailyCandles, weeklyCandles, h4Candles] = await Promise.all([
      this.marketData.getCandles(symbol, '1d' as AnalysisTimeframe, 60),
      this.marketData.getCandles(symbol, '1w' as AnalysisTimeframe, 52),
      this.marketData.getCandles(symbol, '4h' as AnalysisTimeframe, 100),
    ]);

    const analysis    = analyzeSwingPa(symbol, dailyCandles, weeklyCandles, h4Candles);
    const text        = formatSwingPaMessage(analysis);
    const chartBuffer = await renderSwingPaChart(analysis, dailyCandles as Candle[]);

    return { text, chartBuffer };
  }

  async analyzeAndSend(symbol: string, chatId: string): Promise<void> {
    const { text, chartBuffer } = await this.analyze(symbol);

    // Send text analysis first, then chart image to the same chat
    await this.telegramService.sendToChat(chatId, text);
    await this.telegramService.sendPhotoToChat(chatId, chartBuffer, `${symbol} Daily — Pure PA Swing`);
  }
}
