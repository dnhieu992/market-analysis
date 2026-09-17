import { Injectable, Logger } from '@nestjs/common';
import { calculateQqe } from '@app/core';
import { createBitgetSetupConfigRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TelegramService } from '../telegram/telegram.service';

/**
 * colinmck "QQE Signals" params. MUST stay in lockstep with `QQE_PARAMS` in
 * apps/api/src/modules/bitget/setup-chart-renderer.ts so this alert fires on
 * exactly the Long/Short flip the /bitget Setup-tab "QQE" column shows.
 */
const QQE_PARAMS = { rsiPeriod: 10, smoothing: 4, qqeFactor: 3.2 } as const;

/** Candles pulled per coin — enough to warm the QQE bands (mirrors the API side). */
const KLINE_LIMIT = 200;
/** Below this many closed candles the QQE bands haven't warmed — skip the coin. */
const MIN_CANDLES = 60;
/** Cap concurrent Binance klines calls so a big Setup tab doesn't hammer the API. */
const FETCH_CONCURRENCY = 6;

const bareSymbol = (s: string) => s.trim().toUpperCase().replace(/USDT$/, '');

type QqeState = 'long' | 'short';
type QqeAlert = { symbol: string; state: QqeState };

/**
 * Post-H4-close QQE alerter for the /bitget Setup tab. On each closed 4h candle
 * it recomputes colinmck QQE for every distinct coin the trader keeps in the
 * Setup tab and Telegrams the ones whose just-closed candle IS a fresh Long
 * (bull) / Short (bear) flip.
 */
@Injectable()
export class BitgetQqeAlertService {
  private readonly logger = new Logger(BitgetQqeAlertService.name);
  private readonly setupRepo = createBitgetSetupConfigRepository();
  /** Overlap guard — an H4 tick must never stack on a still-running one. */
  private running = false;

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Scan every Setup-tab coin on the last CLOSED 4h candle and alert on fresh
   * QQE flips. `freshCross` (the flip printed on this just-closed candle) is what
   * gates a send, so each flip alerts exactly once — no dedup store is needed:
   * the next tick sees a different "last closed candle" and won't re-fire it.
   */
  async checkAndAlert(): Promise<void> {
    if (this.running) {
      this.logger.warn('QQE H4 alert already running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      const configs = await this.setupRepo.findAll();
      const symbols = [...new Set(configs.map((c) => bareSymbol(c.symbol)))].filter(Boolean);
      if (symbols.length === 0) {
        this.logger.log('QQE H4 alert — Setup tab is empty, nothing to scan');
        return;
      }

      const alerts: QqeAlert[] = [];
      await this.runPooled(symbols, async (bare) => {
        const state = await this.freshCrossFor(bare);
        if (state) alerts.push({ symbol: bare, state });
      });

      if (alerts.length === 0) {
        this.logger.log(`QQE H4 alert — ${symbols.length} coins scanned, no fresh flips`);
        return;
      }

      alerts.sort((a, b) => a.symbol.localeCompare(b.symbol));
      const res = await this.telegram.sendToChat(
        process.env.TELEGRAM_CHAT_ID ?? '',
        this.formatMessage(alerts),
      );
      this.logger.log(
        `QQE H4 alert — ${alerts.length} fresh flip(s): ${alerts
          .map((a) => `${a.symbol}:${a.state}`)
          .join(', ')} (telegram ${res.success ? 'sent' : 'failed'})`,
      );
    } catch (err) {
      this.logger.error(
        `QQE H4 alert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * The QQE state IF the last closed 4h candle is itself the flip bar, else null.
   * `cross[]` is aligned 1:1 with the closed-candle closes, so the last element
   * is non-null only on a brand-new Long/Short signal.
   */
  private async freshCrossFor(bare: string): Promise<QqeState | null> {
    try {
      const klines = await this.binance.fetchKlines({
        symbol: `${bare}USDT`,
        timeframe: '4h',
        limit: KLINE_LIMIT,
      });
      const now = Date.now();
      // Drop the still-forming candle — it would repaint the signal.
      const closes = klines.filter((k) => Number(k[6]) <= now).map((k) => parseFloat(k[4]));
      if (closes.length < MIN_CANDLES) return null;

      const { cross } = calculateQqe(
        closes,
        QQE_PARAMS.rsiPeriod,
        QQE_PARAMS.smoothing,
        QQE_PARAMS.qqeFactor,
      );
      const last = cross[cross.length - 1];
      return last === 'long' || last === 'short' ? last : null;
    } catch (err) {
      this.logger.warn(
        `QQE fetch/compute failed for ${bare}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private formatMessage(alerts: QqeAlert[]): string {
    const lines = alerts.map((a) =>
      a.state === 'long'
        ? `🟢 <b>${a.symbol}</b> — QQE báo <b>BULL</b> (Long)`
        : `🔴 <b>${a.symbol}</b> — QQE báo <b>BEAR</b> (Short)`,
    );
    return [
      '🔔 <b>QQE H4 — tín hiệu mới (Setup tab)</b>',
      '',
      ...lines,
      '',
      '⏱ Nến H4 vừa đóng cửa',
    ].join('\n');
  }

  /** Run `task` over every item with at most FETCH_CONCURRENCY in flight. */
  private async runPooled<T>(items: T[], task: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < items.length) {
        await task(items[next++]!);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, items.length) }, () => worker()),
    );
  }
}
