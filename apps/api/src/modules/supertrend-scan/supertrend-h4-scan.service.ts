import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { calcSupertrend, calculateQqe, type Candle } from '@app/core';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';

/**
 * 4H screener over every Binance USDT spot pair: Supertrend(10,3) bullish **and**
 * QQE bullish on the last closed 4H candle.
 *
 * The daily sibling (`SupertrendScanService`) answers "which coins are in an
 * uptrend"; this one answers "which of those also have 4H momentum right now".
 * Coins whose Supertrend flipped bearish → bullish on that very candle are the
 * fresh ones, so they are listed first and in bold.
 *
 * Like the daily scan nothing is persisted — the output is a Telegram message.
 */

const SUPERTREND_PERIOD = 10;
const SUPERTREND_MULTIPLIER = 3;

/** QQE Signals defaults (colinmck) — same parameters the Bitget/MEXC tables use. */
const QQE_RSI_PERIOD = 14;
const QQE_SMOOTHING = 5;
const QQE_FACTOR = 4.238;

/**
 * 4H candles pulled per coin. The QQE trailing line double-smooths with a
 * 27-period EMA, so it needs far more warm-up than the 10-period ATR.
 */
const CANDLE_LIMIT = 400;

/** Below this many closed 4H candles both indicators still read their seed bar. */
const MIN_CLOSED_CANDLES = 200;

/** Same budget as the daily scan — ~470 pairs × weight 2 stays well under 6000/min. */
const CONCURRENCY = 8;

/**
 * 5 minutes after every 4H close (00:00, 04:00, … UTC). Binance seals the candle
 * on the dot; the delay only guards against clock skew.
 */
const SCAN_CRON = '0 5 */4 * * *';

/** Coins per line in the Telegram list — keeps every line far under the 4000-char chunk cut. */
const COINS_PER_LINE = 12;

export type SupertrendH4ScanResult = {
  /** Symbols that were actually evaluated. */
  scanned: number;
  /** Base assets with a bullish 4H Supertrend *and* bullish QQE — includes `flipped`. */
  bullish: string[];
  /** Subset of `bullish` whose Supertrend flipped bearish → bullish on the last closed candle. */
  flipped: string[];
  /** Skipped for too little history. */
  skipped: number;
  /** Klines that could not be fetched. */
  failed: number;
  telegramSent: boolean;
  startedAt: string;
  durationMs: number;
};

type SymbolOutcome =
  | { kind: 'match'; baseAsset: string; flipped: boolean }
  | { kind: 'no-match' }
  | { kind: 'skipped' }
  | { kind: 'failed' };

@Injectable()
export class SupertrendH4ScanService {
  private readonly logger = new Logger(SupertrendH4ScanService.name);
  private scanning = false;

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService
  ) {}

  @Cron(SCAN_CRON, { timeZone: 'UTC' })
  async runScheduledScan(): Promise<void> {
    try {
      const result = await this.scan('scheduled');
      this.logger.log(
        `Scheduled 4H Supertrend+QQE scan — ${result.bullish.length}/${result.scanned} bullish, ` +
          `${result.flipped.length} fresh flips`
      );
    } catch (error) {
      this.logger.error(
        `Scheduled 4H Supertrend+QQE scan failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Runs the screener and pushes the result to Telegram. Refuses to start while
   * another 4H scan is in flight so the manual button cannot stack onto the cron.
   */
  async scan(trigger: 'scheduled' | 'manual' = 'manual'): Promise<SupertrendH4ScanResult> {
    if (this.scanning) {
      throw new ConflictException('A 4H Supertrend scan is already running');
    }

    this.scanning = true;
    const startedAt = new Date();
    const start = Date.now();

    try {
      const symbols = await this.marketDataService.getSpotUsdtSymbols();
      this.logger.log(
        `4H Supertrend+QQE scan (${trigger}) started — ${symbols.length} USDT spot pairs`
      );

      const bullish: string[] = [];
      const flipped: string[] = [];
      let scanned = 0;
      let skipped = 0;
      let failed = 0;

      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        const batch = symbols.slice(i, i + CONCURRENCY);
        const outcomes = await Promise.all(
          batch.map((entry) => this.evaluateSymbol(entry.symbol, entry.baseAsset))
        );

        for (const outcome of outcomes) {
          if (outcome.kind === 'skipped') skipped += 1;
          else if (outcome.kind === 'failed') failed += 1;
          else {
            scanned += 1;
            if (outcome.kind === 'match') {
              bullish.push(outcome.baseAsset);
              if (outcome.flipped) flipped.push(outcome.baseAsset);
            }
          }
        }
      }

      bullish.sort((a, b) => a.localeCompare(b));
      flipped.sort((a, b) => a.localeCompare(b));

      const { success } = await this.telegramService.sendMessage(
        formatScanMessage(bullish, flipped, scanned, startedAt),
        { parseMode: 'HTML' }
      );
      if (!success) {
        this.logger.warn('4H Supertrend+QQE scan result could not be delivered to Telegram');
      }

      const durationMs = Date.now() - start;
      this.logger.log(
        `4H Supertrend+QQE scan (${trigger}) done in ${Math.round(durationMs / 1000)}s — ` +
          `${bullish.length} bullish (${flipped.length} flips), ${scanned} scanned, ` +
          `${skipped} skipped, ${failed} failed`
      );

      return {
        scanned,
        bullish,
        flipped,
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

  private async evaluateSymbol(symbol: string, baseAsset: string): Promise<SymbolOutcome> {
    let candles: Candle[];
    try {
      candles = await this.marketDataService.getCandles(symbol, '4h', CANDLE_LIMIT);
    } catch {
      return { kind: 'failed' };
    }

    const closed = dropUnclosedCandle(candles);
    if (closed.length < MIN_CLOSED_CANDLES) return { kind: 'skipped' };

    const bars = calcSupertrend(closed, SUPERTREND_PERIOD, SUPERTREND_MULTIPLIER);
    const last = bars[bars.length - 1];
    const previous = bars[bars.length - 2];
    if (!last || !previous || Number.isNaN(last.value) || !last.bullish) return { kind: 'no-match' };

    const qqe = calculateQqe(
      closed.map((candle) => candle.close),
      QQE_RSI_PERIOD,
      QQE_SMOOTHING,
      QQE_FACTOR
    );
    if (!isQqeBullish(qqe, closed.length - 1)) return { kind: 'no-match' };

    return { kind: 'match', baseAsset, flipped: !previous.bullish };
  }
}

/**
 * QQE is bullish while its trailing line sits **below** the smoothed RSI — the
 * same state colinmck's study prints a Long marker for on its first bar. Reading
 * the state (not just the cross bar) keeps a coin on the list for as long as the
 * momentum holds, instead of only on the single candle it turned.
 */
function isQqeBullish(qqe: { rsiMa: number[]; signal: number[] }, index: number): boolean {
  const rsiMa = qqe.rsiMa[index];
  const signal = qqe.signal[index];
  if (rsiMa === undefined || signal === undefined) return false;
  if (Number.isNaN(rsiMa) || Number.isNaN(signal)) return false;
  return signal < rsiMa;
}

/**
 * Binance returns the in-progress candle last; the scan must only read closed
 * ones, so anything whose close time is still in the future is dropped.
 */
function dropUnclosedCandle(candles: Candle[]): Candle[] {
  const now = Date.now();
  return candles.filter((candle) => !candle.closeTime || candle.closeTime.getTime() <= now);
}

/** `2026-08-10 12:00 UTC` — the 4H slot the scan read. */
function formatSlot(startedAt: Date): string {
  return `${startedAt.toISOString().slice(0, 10)} ${startedAt.toISOString().slice(11, 16)} UTC`;
}

/** Wraps the list at `COINS_PER_LINE` so a chunk split never lands inside a `<b>` tag. */
function formatCoinLines(coins: string[], bold: boolean): string {
  const lines: string[] = [];
  for (let i = 0; i < coins.length; i += COINS_PER_LINE) {
    const line = coins.slice(i, i + COINS_PER_LINE).join(', ');
    lines.push(bold ? `<b>${line}</b>` : line);
  }
  return lines.join('\n');
}

function formatScanMessage(
  bullish: string[],
  flipped: string[],
  scanned: number,
  startedAt: Date
): string {
  const header =
    `🟢 Supertrend(10,3) + QQE H4 Bullish — ${formatSlot(startedAt)}\n` +
    `${bullish.length}/${scanned} coins`;

  if (bullish.length === 0) {
    return `${header}\n\nKhông có coin nào bullish.`;
  }

  const sections: string[] = [header];

  if (flipped.length > 0) {
    sections.push(
      `🔥 Vừa đảo chiều bearish → bullish (${flipped.length}):\n${formatCoinLines(flipped, true)}`
    );
  }

  const holding = bullish.filter((coin) => !flipped.includes(coin));
  if (holding.length > 0) {
    sections.push(`Đang bullish (${holding.length}):\n${formatCoinLines(holding, false)}`);
  }

  return sections.join('\n\n');
}
