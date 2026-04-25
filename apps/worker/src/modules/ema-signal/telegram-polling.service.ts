import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

import { TelegramService } from '../telegram/telegram.service';
import { SwingPaService } from '../analysis/swing-pa.service';
import { EmaSignalService } from './ema-signal.service';
import { WatchlistService } from './watchlist.service';

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
};

type Kline = [number, string, string, string, string, string, number, ...unknown[]];

@Injectable()
export class TelegramPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollingService.name);
  private readonly http: AxiosInstance;
  private readonly botToken: string;
  private lastUpdateId = 0;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private candleHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly emaSignalService: EmaSignalService,
    private readonly telegramService: TelegramService,
    private readonly watchlistService: WatchlistService,
    private readonly swingPaService: SwingPaService
  ) {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
    this.http = axios.create({
      baseURL: 'https://api.telegram.org',
      timeout: 10_000
    });
  }

  onModuleInit() {
    void this.deleteWebhook();
    this.pollHandle = setInterval(() => { void this.poll(); }, 2_000);
    this.candleHandle = setInterval(() => { void this.checkCandles(); }, 30_000);
    this.logger.log('Telegram polling and candle watcher started');
  }

  private async deleteWebhook(): Promise<void> {
    try {
      await this.http.get(`/bot${this.botToken}/deleteWebhook`);
      this.logger.log('Webhook deleted — polling mode active');
    } catch (error) {
      this.logger.warn(`deleteWebhook failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  onModuleDestroy() {
    if (this.pollHandle) clearInterval(this.pollHandle);
    if (this.candleHandle) clearInterval(this.candleHandle);
  }

  private async poll(): Promise<void> {
    try {
      const response = await this.http.get<{ ok: boolean; result: TelegramUpdate[] }>(
        `/bot${this.botToken}/getUpdates`,
        { params: { offset: this.lastUpdateId + 1, timeout: 1 } }
      );
      for (const update of response.data.result) {
        this.lastUpdateId = update.update_id;
        try {
          await this.handleUpdate(update);
        } catch (error) {
          this.logger.warn(`handleUpdate failed for update ${update.update_id}: ${error instanceof Error ? error.message : 'unknown'}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Poll failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const text = update.message?.text?.trim();
    const rawChatId = update.message?.chat.id;
    if (!text || rawChatId == null) return;
    const chatId = String(rawChatId);

    // /btcusdt swing → pure price action swing analysis + chart image
    const swingMatch = /^\/([A-Z0-9]+)\s+swing$/i.exec(text);
    if (swingMatch) {
      const symbol = swingMatch[1]!.toUpperCase();
      await this.telegramService.sendToChat(chatId, `⏳ Analyzing ${symbol} (swing PA)...`);
      try {
        await this.swingPaService.analyzeAndSend(symbol, chatId);
      } catch (err) {
        await this.telegramService.sendToChat(
          chatId,
          `❌ Analysis failed for ${symbol}: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }
      return;
    }

    const watchMatch = /^\/watch\s+([A-Z0-9]+)$/i.exec(text);
    if (watchMatch) {
      const symbol = watchMatch[1]!.toUpperCase();
      const result = this.watchlistService.watch(symbol, chatId);
      const reply = result === 'added'
        ? `Watching ${symbol} ✓`
        : `Already watching ${symbol}`;
      await this.telegramService.sendToChat(chatId, reply);
      return;
    }

    const unwatchMatch = /^\/unwatch\s+([A-Z0-9]+)$/i.exec(text);
    if (unwatchMatch) {
      const symbol = unwatchMatch[1]!.toUpperCase();
      const result = this.watchlistService.unwatch(symbol, chatId);
      const reply = result === 'removed'
        ? `Stopped watching ${symbol}`
        : `Not watching ${symbol}`;
      await this.telegramService.sendToChat(chatId, reply);
      return;
    }
  }

  private async checkCandles(): Promise<void> {
    const symbols = this.watchlistService.getWatchedSymbols();
    for (const symbol of symbols) {
      await this.checkSymbol(symbol);
    }
  }

  private async checkSymbol(symbol: string): Promise<void> {
    try {
      const klines = await this.emaSignalService.fetchLatestM15Candles(symbol);
      if (klines.length < 2) return;

      const closedCandle = klines[0] as Kline;
      const closeTime = closedCandle[6];
      const lastSent = this.watchlistService.getLastSentCloseTime(symbol);

      if (closeTime <= lastSent) return;

      const signal = await this.emaSignalService.getSignal(symbol);
      if (signal.includes('Waiting')) return;

      const chatIds = this.watchlistService.getChatIds(symbol);
      for (const chatId of chatIds) {
        await this.telegramService.sendToChat(chatId, signal);
      }

      this.watchlistService.updateLastSentCloseTime(symbol, closeTime);
      this.logger.log(`Sent signal for ${symbol} (candle closed at ${closeTime})`);
    } catch (error) {
      this.logger.warn(`Candle check failed for ${symbol}: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}
