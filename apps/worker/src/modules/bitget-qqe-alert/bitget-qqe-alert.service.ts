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

/**
 * Timeframes we run the QQE flip scan on — a subset of Binance's kline intervals,
 * so the value doubles as the `fetchKlines` timeframe. Same params/logic, different candle.
 */
export type QqeTimeframe = '4h' | '1d';

/**
 * Per-timeframe display metadata. `label` is what the Telegram header shows so
 * the trader can tell an H4 alert from a D1 one at a glance.
 */
const TF_META: Record<QqeTimeframe, { label: string; candleName: string }> = {
  '4h': { label: 'H4', candleName: 'H4' },
  '1d': { label: 'D1', candleName: 'D1 (ngày)' },
};

type QqeState = 'long' | 'short';
type QqeAlert = { symbol: string; state: QqeState };

/**
 * Post-candle-close QQE alerter for the /bitget Setup tab. On each closed candle
 * (H4 or D1) it recomputes colinmck QQE for every distinct coin the trader keeps
 * in the Setup tab and Telegrams the ones whose just-closed candle IS a fresh
 * Long (bull) / Short (bear) flip. The message header names the timeframe.
 */
@Injectable()
export class BitgetQqeAlertService {
  private readonly logger = new Logger(BitgetQqeAlertService.name);
  private readonly setupRepo = createBitgetSetupConfigRepository();
  /** Overlap guard, per timeframe — a tick must never stack on a still-running
   * one of the SAME timeframe, but H4 and D1 (both near 00:00 UTC) may overlap. */
  private readonly running = new Set<QqeTimeframe>();

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
  async checkAndAlert(timeframe: QqeTimeframe = '4h'): Promise<void> {
    const { label } = TF_META[timeframe];
    if (this.running.has(timeframe)) {
      this.logger.warn(`QQE ${label} alert already running — skipping this tick`);
      return;
    }
    this.running.add(timeframe);
    try {
      const configs = await this.setupRepo.findAll();
      const symbols = [...new Set(configs.map((c) => bareSymbol(c.symbol)))].filter(Boolean);
      if (symbols.length === 0) {
        // Still send a heartbeat so the user knows the scan ran (just had no coins).
        const res = await this.telegram.sendToChat(
          process.env.TELEGRAM_CHAT_ID ?? '',
          this.formatNoSignalMessage(timeframe, 0),
        );
        this.logger.log(`QQE ${label} alert — Setup tab empty, sent notice (telegram ${res.success ? 'sent' : 'failed'})`);
        return;
      }

      const alerts: QqeAlert[] = [];
      await this.runPooled(symbols, async (bare) => {
        const state = await this.crossFor(bare, 'fresh', timeframe);
        if (state) alerts.push({ symbol: bare, state });
      });

      // Always send a message on each candle close — flips if any, otherwise a
      // "no fresh signal" heartbeat so silence never looks like a broken bot.
      if (alerts.length === 0) {
        const res = await this.telegram.sendToChat(
          process.env.TELEGRAM_CHAT_ID ?? '',
          this.formatNoSignalMessage(timeframe, symbols.length),
        );
        this.logger.log(
          `QQE ${label} alert — ${symbols.length} coins scanned, no fresh flips (telegram ${res.success ? 'sent' : 'failed'})`,
        );
        return;
      }

      alerts.sort((a, b) => a.symbol.localeCompare(b.symbol));
      const res = await this.telegram.sendToChat(
        process.env.TELEGRAM_CHAT_ID ?? '',
        this.formatMessage(alerts, timeframe),
      );
      this.logger.log(
        `QQE ${label} alert — ${alerts.length} fresh flip(s): ${alerts
          .map((a) => `${a.symbol}:${a.state}`)
          .join(', ')} (telegram ${res.success ? 'sent' : 'failed'})`,
      );
    } catch (err) {
      this.logger.error(
        `QQE ${label} alert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running.delete(timeframe);
    }
  }

  /**
   * Manual-test helper (used by scripts/trigger-qqe-alert.ts, NOT the cron): the
   * CURRENT QQE regime of every Setup-tab coin — the last non-null cross in the
   * series — regardless of whether the just-closed candle is the flip bar. Lets a
   * manual run exercise the full DB → Binance → QQE → Telegram path on demand.
   * Returns the states; the caller decides how to format/send them.
   */
  async previewCurrentStates(timeframe: QqeTimeframe = '4h'): Promise<QqeAlert[]> {
    const configs = await this.setupRepo.findAll();
    const symbols = [...new Set(configs.map((c) => bareSymbol(c.symbol)))].filter(Boolean);
    const states: QqeAlert[] = [];
    await this.runPooled(symbols, async (bare) => {
      const state = await this.crossFor(bare, 'current', timeframe);
      if (state) states.push({ symbol: bare, state });
    });
    states.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return states;
  }

  /**
   * The QQE state for a coin's closed candles on `timeframe` (H4 or D1). `cross[]`
   * is aligned 1:1 with the closed-candle closes. `mode: 'fresh'` returns a state
   * only when the LAST candle is itself the flip bar (a brand-new signal);
   * `mode: 'current'` returns the last non-null cross, i.e. the regime the coin is
   * in right now. Null on any failure.
   */
  private async crossFor(
    bare: string,
    mode: 'fresh' | 'current',
    timeframe: QqeTimeframe,
  ): Promise<QqeState | null> {
    try {
      const klines = await this.binance.fetchKlines({
        symbol: `${bare}USDT`,
        timeframe,
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
      if (mode === 'fresh') {
        const last = cross[cross.length - 1];
        return last === 'long' || last === 'short' ? last : null;
      }
      // 'current' — the most recent non-null flip defines the standing regime.
      for (let i = cross.length - 1; i >= 0; i--) {
        const c = cross[i];
        if (c === 'long' || c === 'short') return c;
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `QQE fetch/compute failed for ${bare}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private formatMessage(alerts: QqeAlert[], timeframe: QqeTimeframe): string {
    const { label, candleName } = TF_META[timeframe];
    const lines = alerts.map((a) =>
      a.state === 'long'
        ? `🟢 <b>${a.symbol}</b> — QQE báo <b>BULL</b> (Long)`
        : `🔴 <b>${a.symbol}</b> — QQE báo <b>BEAR</b> (Short)`,
    );
    return [
      `🔔 <b>[${label}] QQE — tín hiệu mới (Setup tab)</b>`,
      '',
      ...lines,
      '',
      `⏱ Nến ${candleName} vừa đóng cửa`,
    ].join('\n');
  }

  /** Heartbeat when a candle closed with no fresh flip (or no coins to scan). */
  private formatNoSignalMessage(timeframe: QqeTimeframe, scanned: number): string {
    const { label, candleName } = TF_META[timeframe];
    const body =
      scanned === 0
        ? 'Setup tab đang trống — không có coin nào để quét.'
        : `Đã quét ${scanned} coin, không có coin nào vừa đảo chiều QQE.`;
    return [`🔕 <b>[${label}] QQE — không có tín hiệu mới</b>`, '', body, '', `⏱ Nến ${candleName} vừa đóng cửa`].join('\n');
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
