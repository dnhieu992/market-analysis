import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

import { TelegramService } from '../telegram/telegram.service';
import { SwingPaService } from '../analysis/swing-pa.service';
import { SwingSignalService, type SymbolDebugResult, type SymbolScanResult } from '../swing-signal/swing-signal.service';
import { EmaSignalService } from './ema-signal.service';
import { WatchlistService } from './watchlist.service';

function recEmoji(rec: string): string {
  if (rec === 'BUY_NOW') return '🟢';
  if (rec === 'WAIT_FOR_PULLBACK') return '🟡';
  if (rec === 'WAIT_FOR_BREAKOUT') return '🔵';
  if (rec === 'ERROR') return '❌';
  return '⚪';
}

function formatSymbolScanResult(r: SymbolScanResult): string {
  const emoji = r.signalSent ? recEmoji(r.recommendation) : recEmoji(r.error ? 'ERROR' : 'SKIP');
  const setupInfo = r.validSetupCount > 0 ? ` (${r.validSetupCount} setup)` : '';
  const summaryLine = r.summary ? `\n   ${r.summary}` : '';
  return `${emoji} <b>${r.symbol}</b>: ${r.recommendation}${setupInfo}${summaryLine}`;
}

function formatDebugResult(result: SymbolDebugResult): string {
  if (result.stage === 'insufficient_candles') {
    return `❌ ${result.symbol}: Not enough candles to analyze.`;
  }
  if (result.stage === 'api_failed') {
    return `❌ ${result.symbol}: Claude API call failed (check server logs for HTTP status/details).`;
  }
  if (result.stage === 'parse_failed') {
    return `❌ ${result.symbol}: Claude returned invalid JSON.\n\nRaw snippet:\n<code>${result.rawSnippet}</code>`;
  }

  const { symbol, currentPrice, recommendation, overallAssessment, trendAlignment,
          patternsCount, rawSetupCount, validSetupCount, rejections, summary } = result;

  const trendLine = `W: ${trendAlignment.weekly} | D: ${trendAlignment.daily} | 4H: ${trendAlignment.fourHour}`;
  const alignedLine = trendAlignment.aligned ? '✅ Aligned' : '⚠️ Not aligned';

  const setupLine = rawSetupCount === 0
    ? '⚪ Claude generated 0 setups (SKIP at source)'
    : validSetupCount === 0
      ? `🔴 ${rawSetupCount} setup(s) generated → all rejected by validator`
      : `🟢 ${rawSetupCount} setup(s) generated → ${validSetupCount} passed validation`;

  const rejectionLines = rejections.length > 0
    ? `\nRejection reasons:\n${rejections.map(r => `  • ${r}`).join('\n')}`
    : '';

  return [
    `🔍 Debug: ${symbol}`,
    `Price: $${currentPrice}`,
    `Assessment: ${overallAssessment}`,
    `Recommendation: ${recommendation}`,
    '',
    `Trend: ${trendLine}`,
    alignedLine,
    '',
    `Patterns detected: ${patternsCount}`,
    setupLine,
    rejectionLines,
    '',
    `Summary: ${summary}`
  ].filter(l => l !== undefined).join('\n');
}

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
    private readonly swingPaService: SwingPaService,
    private readonly swingSignalService: SwingSignalService
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

    // /check → trigger daily swing signal scan immediately
    if (/^\/check$/i.test(text)) {
      await this.telegramService.sendToChat(chatId, '⏳ Running swing signal scan...');
      try {
        const summary = await this.swingSignalService.checkAll();

        if (summary.total === 0) {
          await this.telegramService.sendToChat(
            chatId,
            '⚠️ No symbols in watchlist.\n\nAdd symbols via the Profile page on the web app.'
          );
          return;
        }

        const perSymbolLines = summary.symbolResults
          .map((r) => formatSymbolScanResult(r))
          .join('\n');

        const errorLine = summary.errors > 0
          ? `\n⚠️ ${summary.errors} symbol(s) failed (see server logs)`
          : '';

        await this.telegramService.sendToChat(
          chatId,
          `✅ Scan complete — ${summary.total} symbol(s) checked, ${summary.signals} signal(s) sent.\n\n${perSymbolLines}${errorLine}`
        );
      } catch (err) {
        await this.telegramService.sendToChat(
          chatId,
          `❌ Scan failed: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }
      return;
    }

    // /check SYMBOL → debug single symbol, show full pipeline result
    const checkSymbolMatch = /^\/check\s+([A-Z0-9]+)$/i.exec(text);
    if (checkSymbolMatch) {
      const symbol = checkSymbolMatch[1]!.toUpperCase();
      await this.telegramService.sendToChat(chatId, `⏳ Debugging ${symbol}...`);
      try {
        const result = await this.swingSignalService.debugSymbol(symbol);
        await this.telegramService.sendToChat(chatId, formatDebugResult(result));
      } catch (err) {
        await this.telegramService.sendToChat(
          chatId,
          `❌ Debug failed for ${symbol}: ${err instanceof Error ? err.message : 'unknown error'}`
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
