import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { isSupertrendBullish, type Candle } from '@app/core';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';
import { TrackingScanSymbolsService } from './tracking-scan-symbols.service';

/**
 * Daily Supertrend(10,3) screener over the /tracking-coins watchlist.
 *
 * It is a pre-filter, not a signal: the list of coins whose D1 Supertrend is
 * bullish on the last *closed* daily candle goes to Telegram as plain names, so
 * the trader opens only those charts. Nothing is persisted or shown in the app.
 */

const SUPERTREND_PERIOD = 10;
const SUPERTREND_MULTIPLIER = 3;

/** Daily candles pulled per coin — plenty of warm-up for a 10-period ATR. */
const CANDLE_LIMIT = 200;

/**
 * A coin needs this many closed daily candles before its Supertrend is trusted;
 * fresh listings would otherwise report whatever the seed bar dictates.
 */
const MIN_CLOSED_CANDLES = 60;

/**
 * Symbols fetched in parallel. A watchlist is a few dozen coins, so 8 at a time
 * finishes in seconds and stays far under Binance's 6000/min IP budget.
 */
const CONCURRENCY = 8;

/** 00:10 UTC — ten minutes after the daily candle closes. */
const SCAN_CRON = '0 10 0 * * *';

export type SupertrendScanResult = {
  /** Symbols that were actually evaluated. */
  scanned: number;
  /** Base assets in a D1 Supertrend uptrend. */
  bullish: string[];
  /** Skipped for too little history. */
  skipped: number;
  /** Klines that could not be fetched. */
  failed: number;
  telegramSent: boolean;
  startedAt: string;
  durationMs: number;
};

@Injectable()
export class SupertrendScanService {
  private readonly logger = new Logger(SupertrendScanService.name);
  private scanning = false;

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService,
    private readonly scanSymbols: TrackingScanSymbolsService
  ) {}

  @Cron(SCAN_CRON, { timeZone: 'UTC' })
  async runScheduledScan(): Promise<void> {
    try {
      const result = await this.scan('scheduled');
      this.logger.log(
        `Scheduled Supertrend scan — ${result.bullish.length}/${result.scanned} bullish`
      );
    } catch (error) {
      this.logger.error(
        `Scheduled Supertrend scan failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Runs the screener and pushes the result to Telegram. Refuses to start while
   * another scan is in flight so the manual button cannot stack onto the cron.
   */
  async scan(trigger: 'scheduled' | 'manual' = 'manual'): Promise<SupertrendScanResult> {
    if (this.scanning) {
      throw new ConflictException('A Supertrend scan is already running');
    }

    this.scanning = true;
    const startedAt = new Date();
    const start = Date.now();

    try {
      const symbols = await this.scanSymbols.list();
      this.logger.log(`Supertrend scan (${trigger}) started — ${symbols.length} watchlist coins`);

      const bullish: string[] = [];
      let scanned = 0;
      let skipped = 0;
      let failed = 0;

      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        const batch = symbols.slice(i, i + CONCURRENCY);
        const outcomes = await Promise.all(
          batch.map(async (entry) => {
            try {
              const candles = await this.marketDataService.getCandles(entry.symbol, '1d', CANDLE_LIMIT);
              const closed = dropUnclosedCandle(candles);
              if (closed.length < MIN_CLOSED_CANDLES) return 'skipped' as const;

              return isSupertrendBullish(closed, SUPERTREND_PERIOD, SUPERTREND_MULTIPLIER)
                ? entry.baseAsset
                : ('bearish' as const);
            } catch {
              return 'failed' as const;
            }
          })
        );

        for (const outcome of outcomes) {
          if (outcome === 'skipped') skipped += 1;
          else if (outcome === 'failed') failed += 1;
          else {
            scanned += 1;
            if (outcome !== 'bearish') bullish.push(outcome);
          }
        }
      }

      bullish.sort((a, b) => a.localeCompare(b));

      const { success } = await this.telegramService.sendMessage(
        formatScanMessage(bullish, scanned, startedAt)
      );
      if (!success) this.logger.warn('Supertrend scan result could not be delivered to Telegram');

      const durationMs = Date.now() - start;
      this.logger.log(
        `Supertrend scan (${trigger}) done in ${Math.round(durationMs / 1000)}s — ` +
          `${bullish.length} bullish, ${scanned} scanned, ${skipped} skipped, ${failed} failed`
      );

      return {
        scanned,
        bullish,
        skipped,
        failed,
        telegramSent: success,
        startedAt: startedAt.toISOString(),
        durationMs,
      };
    } finally {
      this.scanning = false;
    }
  }
}

/**
 * Binance returns the in-progress candle last; the scan must only read closed
 * ones, so anything whose close time is still in the future is dropped.
 */
function dropUnclosedCandle(candles: Candle[]): Candle[] {
  const now = Date.now();
  return candles.filter((candle) => !candle.closeTime || candle.closeTime.getTime() <= now);
}

function formatScanMessage(bullish: string[], scanned: number, startedAt: Date): string {
  const day = startedAt.toISOString().slice(0, 10);
  const header = `🟢 Supertrend(10,3) D1 Bullish — ${day} UTC\n${bullish.length}/${scanned} coins theo dõi`;

  if (scanned === 0) {
    return `${header}\n\nDanh sách theo dõi đang trống — thêm coin ở trang /tracking-coins.`;
  }

  if (bullish.length === 0) {
    return `${header}\n\nKhông có coin nào bullish.`;
  }

  return `${header}\n\n${bullish.join(', ')}`;
}
