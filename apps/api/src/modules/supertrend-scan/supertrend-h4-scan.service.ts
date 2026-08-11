import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { calcSupertrend, calculateQqe, type Candle } from '@app/core';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';
import { TrackingScanSymbolsService } from './tracking-scan-symbols.service';

/**
 * 4H screener over the /tracking-coins watchlist, reading Supertrend(10,3) and
 * QQE on the last closed 4H candle.
 *
 * The daily sibling (`SupertrendScanService`) answers "which coins are in an
 * uptrend"; this one answers "which have 4H trend, which have 4H momentum, and
 * which have both". Each indicator gets its own section in the report — a coin
 * dropping off a blended list never said which of the two turned — and the
 * intersection follows as the actual setup list.
 *
 * Coins whose Supertrend flipped bearish → bullish on that very candle are the
 * fresh ones, so they lead their section and print in bold.
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

/** Same budget as the daily scan — a watchlist of a few dozen coins, 8 at a time. */
const CONCURRENCY = 8;

/**
 * 5 minutes after every 4H close (00:00, 04:00, … UTC). Binance seals the candle
 * on the dot; the delay only guards against clock skew.
 */
const SCAN_CRON = '0 5 */4 * * *';

/** Coins per line in the Telegram list — keeps every line far under the 4000-char chunk cut. */
const COINS_PER_LINE = 12;

/** One 4H candle, used to label the report with the slot it read. */
const SLOT_MS = 4 * 60 * 60 * 1000;

export type SupertrendH4ScanResult = {
  /** Symbols that were actually evaluated. */
  scanned: number;
  /** Base assets with a bullish 4H Supertrend, whatever QQE says. */
  supertrendBullish: string[];
  /** Subset of `supertrendBullish` that flipped bearish → bullish on the last closed candle. */
  flipped: string[];
  /** Base assets with a bullish QQE, whatever Supertrend says. */
  qqeBullish: string[];
  /** The intersection — both indicators bullish on the same candle. */
  bullish: string[];
  /** Skipped for too little history. */
  skipped: number;
  /** Klines that could not be fetched. */
  failed: number;
  telegramSent: boolean;
  startedAt: string;
  durationMs: number;
};

type SymbolOutcome =
  | { kind: 'read'; baseAsset: string; supertrend: boolean; flipped: boolean; qqe: boolean }
  | { kind: 'skipped' }
  | { kind: 'failed' };

@Injectable()
export class SupertrendH4ScanService {
  private readonly logger = new Logger(SupertrendH4ScanService.name);
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
      const symbols = await this.scanSymbols.list();
      this.logger.log(
        `4H Supertrend+QQE scan (${trigger}) started — ${symbols.length} watchlist coins`
      );

      const supertrendBullish: string[] = [];
      const flipped: string[] = [];
      const qqeBullish: string[] = [];
      const bullish: string[] = [];
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
            if (outcome.supertrend) supertrendBullish.push(outcome.baseAsset);
            if (outcome.flipped) flipped.push(outcome.baseAsset);
            if (outcome.qqe) qqeBullish.push(outcome.baseAsset);
            if (outcome.supertrend && outcome.qqe) bullish.push(outcome.baseAsset);
          }
        }
      }

      const byName = (a: string, b: string) => a.localeCompare(b);
      supertrendBullish.sort(byName);
      flipped.sort(byName);
      qqeBullish.sort(byName);
      bullish.sort(byName);

      const { success } = await this.telegramService.sendMessage(
        formatScanMessage({ supertrendBullish, flipped, qqeBullish, bullish, scanned, startedAt }),
        { parseMode: 'HTML' }
      );
      if (!success) {
        this.logger.warn('4H Supertrend+QQE scan result could not be delivered to Telegram');
      }

      const durationMs = Date.now() - start;
      this.logger.log(
        `4H Supertrend+QQE scan (${trigger}) done in ${Math.round(durationMs / 1000)}s — ` +
          `ST ${supertrendBullish.length} (${flipped.length} flips), QQE ${qqeBullish.length}, ` +
          `both ${bullish.length}, ${scanned} scanned, ${skipped} skipped, ${failed} failed`
      );

      return {
        scanned,
        supertrendBullish,
        flipped,
        qqeBullish,
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
    const supertrend = Boolean(last && previous && !Number.isNaN(last.value) && last.bullish);

    // Both indicators are read on every coin, not just the ones Supertrend keeps:
    // the report lists each side on its own before the intersection.
    const qqe = isQqeBullish(
      calculateQqe(
        closed.map((candle) => candle.close),
        QQE_RSI_PERIOD,
        QQE_SMOOTHING,
        QQE_FACTOR
      ),
      closed.length - 1
    );

    const flipped = supertrend && previous !== undefined && !previous.bullish;

    return { kind: 'read', baseAsset, supertrend, flipped, qqe };
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

/**
 * The 4H candle the scan actually read, not the wall clock: floor the start time
 * to a 4H boundary and that is the close of the last sealed candle. A manual run
 * at 09:37 then reports the same `08:00` slot as the data it used — and the same
 * slot the 08:05 cron reported.
 */
function formatSlot(startedAt: Date): string {
  const slot = new Date(Math.floor(startedAt.getTime() / SLOT_MS) * SLOT_MS).toISOString();
  return `${slot.slice(0, 10)} ${slot.slice(11, 16)} UTC`;
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

/**
 * One message, three sections — each indicator reported on its own before the
 * intersection, so it is obvious *why* a coin is on the list. A single blended
 * list could not say whether a coin was missing because its trend turned or
 * because its momentum did.
 */
function formatScanMessage({
  supertrendBullish,
  flipped,
  qqeBullish,
  bullish,
  scanned,
  startedAt,
}: {
  supertrendBullish: string[];
  flipped: string[];
  qqeBullish: string[];
  bullish: string[];
  scanned: number;
  startedAt: Date;
}): string {
  const sections: string[] = [
    `🟢 Scan H4 — nến đóng ${formatSlot(startedAt)}\nQuét ${scanned} coin theo dõi`,
  ];

  if (scanned === 0) {
    return `${sections[0]}\n\nDanh sách theo dõi đang trống — thêm coin ở trang /tracking-coins.`;
  }

  // ── Supertrend, split into fresh flips and coins already in the trend.
  const holding = supertrendBullish.filter((coin) => !flipped.includes(coin));
  const supertrendLines: string[] = [`━━ SUPERTREND(10,3) BULLISH (${supertrendBullish.length}) ━━`];
  if (flipped.length > 0) {
    supertrendLines.push(`🔥 Vừa đảo chiều bearish → bullish (${flipped.length}):`);
    supertrendLines.push(formatCoinLines(flipped, true));
  }
  if (holding.length > 0) {
    supertrendLines.push(`Đang bullish (${holding.length}):`);
    supertrendLines.push(formatCoinLines(holding, false));
  }
  if (supertrendBullish.length === 0) supertrendLines.push('Không có coin nào.');
  sections.push(supertrendLines.join('\n'));

  // ── QQE on its own.
  sections.push(
    `━━ QQE BULLISH (${qqeBullish.length}) ━━\n` +
      (qqeBullish.length > 0 ? formatCoinLines(qqeBullish, false) : 'Không có coin nào.')
  );

  // ── The intersection — the actual setups, flips first.
  const bothFlipped = bullish.filter((coin) => flipped.includes(coin));
  const bothRest = bullish.filter((coin) => !flipped.includes(coin));
  const bothLines: string[] = [`━━ CẢ HAI (${bullish.length}) ━━`];
  if (bothFlipped.length > 0) bothLines.push(`🔥 ${formatCoinLines(bothFlipped, true)}`);
  if (bothRest.length > 0) bothLines.push(formatCoinLines(bothRest, false));
  if (bullish.length === 0) bothLines.push('Không có coin nào.');
  sections.push(bothLines.join('\n'));

  return sections.join('\n\n');
}
