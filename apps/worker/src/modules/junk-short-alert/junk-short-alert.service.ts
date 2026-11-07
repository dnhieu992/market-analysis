import { Injectable, Logger } from '@nestjs/common';
import { formatJunkShortAlert, scanJunkShorts } from '@app/core';
import { createJunkShortCoinRepository, createTelegramMessageLogRepository } from '@app/db';

import { TelegramService } from '../telegram/telegram.service';

/** Junk coins in Binance's top 24h gainers at or above this get a "theo dõi" line. */
const MOVER_MIN_24H_PCT = 25;
const LOG_PREFIX = 'junk-short:';

/**
 * Telegram alert for the "Short Coin Rác" skill. Every tick it runs the shared scan and
 * sends ONE message with what is new: coins whose just-closed D1 printed setup A, and junk
 * coins sitting in Binance's top gainers ≥ +25%/24h. Each (kind, coin, UTC day) is sent at
 * most once — the keys are stored as TelegramMessageLog rows, so a worker restart or deploy
 * does not resend. No heartbeat: silence = nothing new. Only the coins on the /short-junk list
 * are scanned; an empty list means no alert.
 */
@Injectable()
export class JunkShortAlertService {
  private readonly logger = new Logger(JunkShortAlertService.name);
  private readonly logRepo = createTelegramMessageLogRepository();
  private readonly coinRepo = createJunkShortCoinRepository();
  private running = false;

  constructor(private readonly telegram: TelegramService) {}

  async checkAndAlert(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
      const symbols = await this.coinRepo.symbols();
      if (symbols.length === 0) return;
      const scan = await scanJunkShorts({ fapiBaseUrl: process.env.BINANCE_FAPI_BASE_URL, symbols });
      const day = scan.scannedAt.slice(0, 10);
      const setupA = scan.candidates.filter((c) => c.setup === 'A_PUMP_FADE');
      // Every top gainer is on the user's list, so the study's junk gates do not filter movers here.
      const movers = scan.topGainers.filter((g) => g.change24hPct >= MOVER_MIN_24H_PCT && g.setup !== 'A_PUMP_FADE');

      const keyA = (s: string, d: string) => `${LOG_PREFIX}A:${s}:${d}`;
      const keyM = (s: string) => `${LOG_PREFIX}mover:${s}:${day}`;
      const sent = new Set(
        (await this.logRepo.listTypesSince(LOG_PREFIX, new Date(Date.parse(day) - 86_400_000))).map((r) => r.messageType),
      );
      const newA = setupA.filter((c) => !sent.has(keyA(c.symbol, c.signalDate)));
      const newMovers = movers.filter((m) => !sent.has(keyM(m.symbol)));
      if (newA.length === 0 && newMovers.length === 0) return;

      const content = formatJunkShortAlert({ btcBear: scan.btc.bear, setupA: newA, movers: newMovers });
      const res = await this.telegram.sendToChat(chatId, content);
      const sentAt = new Date();
      const keys = [...newA.map((c) => keyA(c.symbol, c.signalDate)), ...newMovers.map((m) => keyM(m.symbol))];
      // One log row per key: it is both the audit trail and the dedup store.
      for (const messageType of keys) {
        await this.logRepo.create({ chatId, messageType, content, success: res.success, sentAt });
      }
      this.logger.log(
        `Junk-short alert — A: ${newA.map((c) => c.symbol).join(',') || '-'} · movers: ${newMovers.map((m) => m.symbol).join(',') || '-'} (telegram ${res.success ? 'sent' : 'failed'})`,
      );
    } catch (err) {
      this.logger.error(`Junk-short alert failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
