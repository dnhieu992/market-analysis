import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

type TelegramConfig = {
  botToken: string;
  chatId: string;
};

type TelegramSendResponse = {
  ok: boolean;
  result?: { message_id?: number };
};

/**
 * Minimal Telegram sender for API-side jobs (the worker has its own copy for
 * the analysis pipeline). Sends never throw — a failed delivery is logged and
 * reported through the return value so the caller can keep going.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly httpClient: AxiosInstance;
  private readonly config: TelegramConfig;

  constructor(
    @Optional() httpClient?: AxiosInstance,
    @Optional() config?: TelegramConfig
  ) {
    this.httpClient =
      httpClient ??
      axios.create({ baseURL: 'https://api.telegram.org', timeout: 10_000 });
    this.config = config ?? {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: process.env.TELEGRAM_CHAT_ID ?? '',
    };
  }

  /**
   * Sends `text` to the configured chat, chunked at Telegram's 4096-char cap.
   *
   * With `parseMode` the chunker splits on newlines only, so callers using HTML
   * must keep every tag inside a single line or a chunk boundary could cut one
   * in half and Telegram would reject the message.
   */
  async sendMessage(
    text: string,
    options?: { parseMode?: 'HTML' | 'Markdown' }
  ): Promise<{ success: boolean }> {
    if (!this.config.botToken || !this.config.chatId) {
      this.logger.warn('Telegram not configured — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing');
      return { success: false };
    }

    for (const chunk of this.chunkMessage(text)) {
      const sent = await this.sendChunk(chunk, options?.parseMode);
      if (!sent) return { success: false };
    }

    return { success: true };
  }

  private chunkMessage(text: string, maxLen = 4000): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > maxLen) {
      const slice = remaining.slice(0, maxLen);
      const cut = slice.lastIndexOf('\n');
      const splitAt = cut > 0 ? cut : maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt + 1);
    }
    if (remaining.length > 0) chunks.push(remaining);

    return chunks;
  }

  private async sendChunk(text: string, parseMode?: 'HTML' | 'Markdown'): Promise<boolean> {
    try {
      await this.httpClient.post<TelegramSendResponse>(
        `/bot${this.config.botToken}/sendMessage`,
        {
          chat_id: this.config.chatId,
          text,
          disable_web_page_preview: true,
          ...(parseMode ? { parse_mode: parseMode } : {}),
        }
      );
      return true;
    } catch (error) {
      const data = (error as { response?: { data?: unknown } }).response?.data;
      this.logger.warn(
        `Telegram send failed: ${error instanceof Error ? error.message : 'unknown'} — ${JSON.stringify(data ?? {})}`
      );
      return false;
    }
  }
}
