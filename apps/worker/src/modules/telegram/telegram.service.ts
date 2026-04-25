import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
// import { createTelegramMessageLogRepository } from '@app/db'; // TODO: re-enable when DB is ready

// type TelegramLogRepository = ReturnType<typeof createTelegramMessageLogRepository>;

type TelegramConfig = {
  botToken: string;
  chatId: string;
};

type SendAnalysisMessageInput = {
  analysisRunId?: string;
  content: string;
  messageType: string;
};

type TelegramSendResponse = {
  ok: boolean;
  result?: {
    message_id?: number;
  };
};

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly httpClient: AxiosInstance;
  private readonly config: TelegramConfig;

  constructor(
    @Optional() httpClient?: AxiosInstance,
    @Optional() config?: TelegramConfig
  ) {
    const resolvedConfig = config ?? {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: process.env.TELEGRAM_CHAT_ID ?? ''
    };

    this.httpClient =
      httpClient ??
      axios.create({
        baseURL: 'https://api.telegram.org',
        timeout: 10_000
      });
    this.config = resolvedConfig;
  }

  async sendAnalysisMessage(input: SendAnalysisMessageInput): Promise<{ success: boolean; messageId?: number }> {
    try {
      const response = await this.httpClient.post<TelegramSendResponse>(
        `/bot${this.config.botToken}/sendMessage`,
        {
          chat_id: this.config.chatId,
          text: input.content
        }
      );

      const messageId = response.data.result?.message_id;

      // await this.recordMessageLog({
      //   analysisRunId: input.analysisRunId,
      //   messageType: input.messageType,
      //   content: input.content,
      //   success: true
      // });

      return {
        success: true,
        messageId
      };
    } catch (error) {
      const status = (error as { response?: { status?: number; data?: unknown } }).response?.status;
      const data = (error as { response?: { status?: number; data?: unknown } }).response?.data;
      this.logger.warn(`Telegram delivery failed — HTTP ${status ?? 'N/A'}: ${JSON.stringify(data) ?? String(error)}`);

      // await this.recordMessageLog({
      //   analysisRunId: input.analysisRunId,
      //   messageType: input.messageType,
      //   content: input.content,
      //   success: false,
      //   errorMessage: error instanceof Error ? error.message : 'Unknown Telegram error'
      // });

      return {
        success: false
      };
    }
  }

  async sendPhoto(imageBuffer: Buffer, caption?: string): Promise<{ success: boolean; messageId?: number }> {
    try {
      const form = new FormData();
      form.append('chat_id', this.config.chatId);
      form.append('photo', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'chart.png');
      if (caption) {
        form.append('caption', caption);
      }

      const response = await this.httpClient.post<TelegramSendResponse>(
        `/bot${this.config.botToken}/sendPhoto`,
        form,
        { timeout: 30_000 }
      );

      return { success: true, messageId: response.data.result?.message_id };
    } catch (error) {
      this.logger.warn(`sendPhoto failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return { success: false };
    }
  }

  async sendPhotoToChat(chatId: string, imageBuffer: Buffer, caption?: string): Promise<{ success: boolean; messageId?: number }> {
    try {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('photo', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'chart.png');
      if (caption) form.append('caption', caption);

      const response = await this.httpClient.post<TelegramSendResponse>(
        `/bot${this.config.botToken}/sendPhoto`,
        form,
        { timeout: 30_000 }
      );

      return { success: true, messageId: response.data.result?.message_id };
    } catch (error) {
      this.logger.warn(`sendPhotoToChat failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return { success: false };
    }
  }

  async sendToChat(chatId: string, text: string): Promise<{ success: boolean; messageId?: number }> {
    try {
      const response = await this.httpClient.post<TelegramSendResponse>(
        `/bot${this.config.botToken}/sendMessage`,
        { chat_id: chatId, text, parse_mode: 'HTML' }
      );
      return { success: true, messageId: response.data.result?.message_id };
    } catch (error) {
      const errData = (error as { response?: { data?: unknown } }).response?.data;
      this.logger.warn(`sendToChat failed: ${error instanceof Error ? error.message : 'unknown'} — ${JSON.stringify(errData ?? {})}`);
      return { success: false };
    }
  }

  // private async recordMessageLog(input: {
  //   analysisRunId?: string;
  //   messageType: string;
  //   content: string;
  //   success: boolean;
  //   errorMessage?: string;
  // }): Promise<void> {
  //   try {
  //     await this.logRepository.create({
  //       analysisRunId: input.analysisRunId,
  //       chatId: this.config.chatId,
  //       messageType: input.messageType,
  //       content: input.content,
  //       success: input.success,
  //       errorMessage: input.errorMessage,
  //       sentAt: new Date()
  //     });
  //   } catch (error) {
  //     this.logger.warn(
  //       `Failed to record Telegram message log: ${error instanceof Error ? error.message : 'unknown error'}`
  //     );
  //   }
  // }
}
