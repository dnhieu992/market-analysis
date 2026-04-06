import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

import { TelegramService } from '../telegram/telegram.service';
import { EmaSignalService } from './ema-signal.service';

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
};

@Injectable()
export class TelegramPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollingService.name);
  private readonly http: AxiosInstance;
  private readonly botToken: string;
  private lastUpdateId = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly emaSignalService: EmaSignalService,
    private readonly telegramService: TelegramService
  ) {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
    this.http = axios.create({
      baseURL: 'https://api.telegram.org',
      timeout: 10_000
    });
  }

  onModuleInit() {
    this.intervalHandle = setInterval(() => {
      void this.poll();
    }, 2_000);
    this.logger.log('Telegram polling started');
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  private async poll(): Promise<void> {
    try {
      const response = await this.http.get<{ ok: boolean; result: TelegramUpdate[] }>(
        `/bot${this.botToken}/getUpdates`,
        { params: { offset: this.lastUpdateId + 1, timeout: 1 } }
      );

      for (const update of response.data.result) {
        this.lastUpdateId = update.update_id;
        await this.handleUpdate(update);
      }
    } catch (error) {
      this.logger.warn(`Poll failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const text = update.message?.text?.trim();
    const chatId = String(update.message?.chat.id);

    if (!text || !chatId) return;

    const match = /^\/([A-Z0-9]+)$/i.exec(text);
    if (!match) return;

    const symbol = match[1]!.toUpperCase();
    this.logger.log(`Signal request: ${symbol} from chat ${chatId}`);

    const signal = await this.emaSignalService.getSignal(symbol);
    await this.telegramService.sendToChat(chatId, signal);
  }
}
