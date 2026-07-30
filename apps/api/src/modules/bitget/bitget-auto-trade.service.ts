import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  createBitgetAutoTradeConfigRepository,
  createBitgetAutoTradeRunRepository,
  createBitgetSetupConfigRepository,
  type BitgetAutoTradeStatus,
} from '@app/db';

import { BitgetService } from './bitget.service';
import { BitgetTradeClient } from './bitget-trade.client';

/**
 * "Auto vào lệnh" engine for the /bitget Setup tab.
 *
 * Strategy (fixed, long-only — the trader's own definition):
 *   1. 00:00 UTC daily — open a market LONG on every enabled coin, using that
 *      coin's saved LONG setup config (leverage + margin, cross).
 *   2. Immediately set a take-profit at entry +2% **on price** (i.e. before
 *      leverage — at 10× that is +20% ROE). The TP lives on the exchange, so it
 *      fires even when this app is down.
 *   3. 09:00 UTC — review each live auto position:
 *        · PnL ≥ −0.5% (in profit, flat, or down at most 0.5%) → force-close at market.
 *        · PnL < −0.5% → leave it running, but move the TP down to the entry
 *          price, so the position exits at break-even (minus fees) on a recovery.
 *
 * Percentages are PRICE moves, not ROE — the same basis as the backtest in
 * `claude-backtest/runs/2026-07-30-eth-0000-long-tp2-close0800.md`.
 *
 * Safety rules baked in:
 *   · One run row per (coin, UTC day), created before/at the entry — a re-fired
 *     cron or a manual trigger can never open a second position for the day.
 *   · A coin that already has a LONG open at 00:00 (yesterday's extended trade,
 *     or a manual one) is skipped for the day, never scaled into.
 *   · The 09:00 review only touches a position whose exchange open time matches
 *     the one this engine opened — a manually opened position is never closed.
 */

/** Take-profit distance from entry, in % of price (before leverage). */
const TP_PCT = 2;

/**
 * At the review hour a position is force-closed unless it is below this. Losing
 * more than 0.5% (on price) is what buys the trade extra time at break-even.
 */
const KEEP_THRESHOLD_PCT = -0.5;

/** 00:00:05 UTC — a few seconds after the daily candle opens. */
const ENTRY_CRON = '5 0 0 * * *';

/** 09:00:00 UTC — the review / force-close hour. */
const REVIEW_CRON = '0 0 9 * * *';

/** Let the exchange register the fill before the TP order is placed on it. */
const TP_SETTLE_DELAY_MS = 1_500;

/**
 * How far the live position's open time may drift from the recorded one and
 * still count as the same position. Bitget stamps `cTime` at fill; anything
 * beyond this is a different position and must not be managed by the engine.
 */
const POSITION_MATCH_TOLERANCE_MS = 10 * 60_000;

/** What the engine did to one coin in one pass — the manual-trigger response. */
export type AutoTradeAction = {
  symbol: string;
  action: 'opened' | 'skipped' | 'failed' | 'already-ran' | 'closed' | 'extended' | 'holding' | 'gone';
  detail: string;
};

/** One coin's auto-entry state for the Setup tab dialog. */
export type BitgetAutoTradeDto = {
  symbol: string;
  enabled: boolean;
  /** Most recent run for the coin (live one when there is any), or null. */
  latestRun: {
    tradeDate: string;
    status: BitgetAutoTradeStatus;
    entryPrice: number | null;
    tpPrice: number | null;
    marginUsd: number | null;
    leverage: number | null;
    exitReason: string | null;
    detail: string | null;
    updatedAt: string;
  } | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** UTC calendar day (YYYY-MM-DD) — the key one trading day is filed under. */
function utcDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  return n.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 8 });
}

@Injectable()
export class BitgetAutoTradeService {
  private readonly logger = new Logger(BitgetAutoTradeService.name);
  private readonly client = new BitgetTradeClient();
  private readonly configRepo = createBitgetAutoTradeConfigRepository();
  private readonly runRepo = createBitgetAutoTradeRunRepository();
  private readonly setupRepo = createBitgetSetupConfigRepository();
  /** Guards against an overlapping pass (cron firing while a manual run is in flight). */
  private running = false;

  constructor(private readonly bitget: BitgetService) {}

  // ── config (the Setup dialog's toggle) ───────────────────────────────────

  /** Every coin's switch + its latest run, for hydrating the Setup tab. */
  async list(): Promise<BitgetAutoTradeDto[]> {
    const [configs, runs] = await Promise.all([
      this.configRepo.findAll(),
      this.runRepo.findLatestPerSymbol(),
    ]);
    const runBySymbol = new Map(runs.map((r) => [r.symbol, r]));
    // A coin can have runs but no config row only if the switch was deleted —
    // list both sides so history never disappears from the dialog.
    const symbols = [...new Set([...configs.map((c) => c.symbol), ...runs.map((r) => r.symbol)])];
    return symbols.sort().map((symbol) => {
      const run = runBySymbol.get(symbol);
      return {
        symbol,
        enabled: configs.find((c) => c.symbol === symbol)?.enabled ?? false,
        latestRun: run
          ? {
              tradeDate: run.tradeDate,
              status: run.status as BitgetAutoTradeStatus,
              entryPrice: run.entryPrice,
              tpPrice: run.tpPrice,
              marginUsd: run.marginUsd,
              leverage: run.leverage,
              exitReason: run.exitReason,
              detail: run.detail,
              updatedAt: run.updatedAt.toISOString(),
            }
          : null,
      };
    });
  }

  /**
   * Turn auto-entry on/off for one coin. Enabling requires a saved LONG config
   * with margin — otherwise the 00:00 job would only ever log a skip, and the
   * trader would think the coin is armed when it is not.
   */
  async setEnabled(input: { symbol: string; enabled: boolean }): Promise<BitgetAutoTradeDto> {
    const symbol = input.symbol.trim().toUpperCase();
    if (input.enabled) {
      const cfg = await this.longConfigOf(symbol);
      if (!cfg) {
        throw new BadRequestException(
          `Cấu hình ký quỹ LONG cho ${symbol} trước khi bật auto vào lệnh.`,
        );
      }
    }
    const row = await this.configRepo.upsert({ symbol, enabled: input.enabled });
    this.logger.log(`Auto-trade ${row.enabled ? 'ENABLED' : 'disabled'} for ${symbol}`);
    const all = await this.list();
    return all.find((a) => a.symbol === symbol) ?? { symbol, enabled: row.enabled, latestRun: null };
  }

  // ── scheduled passes ─────────────────────────────────────────────────────

  @Cron(ENTRY_CRON, { timeZone: 'UTC' })
  async scheduledEntry(): Promise<void> {
    await this.runEntry().catch((err) =>
      this.logger.error(`Auto-trade entry pass failed: ${(err as Error).message}`),
    );
  }

  @Cron(REVIEW_CRON, { timeZone: 'UTC' })
  async scheduledReview(): Promise<void> {
    await this.runReview().catch((err) =>
      this.logger.error(`Auto-trade review pass failed: ${(err as Error).message}`),
    );
  }

  /**
   * 00:00 UTC pass — open the day's LONG on every enabled coin. Every coin is
   * isolated: one failure is recorded on its own run row and the loop continues.
   */
  async runEntry(): Promise<AutoTradeAction[]> {
    const enabled = await this.configRepo.findEnabled();
    if (enabled.length === 0) return [];
    if (!this.client.isConfigured()) {
      this.logger.warn('Auto-trade entry skipped: Bitget credentials not configured');
      return enabled.map((c) => ({
        symbol: c.symbol,
        action: 'skipped' as const,
        detail: 'Chưa cấu hình Bitget API key.',
      }));
    }
    if (this.running) {
      this.logger.warn('Auto-trade entry skipped: another pass is still running');
      return [];
    }

    this.running = true;
    const tradeDate = utcDateOf(new Date());
    const results: AutoTradeAction[] = [];
    try {
      for (const cfg of enabled) {
        results.push(await this.enterOne(cfg.symbol, tradeDate));
      }
    } finally {
      this.running = false;
    }
    this.logger.log(
      `Auto-trade entry ${tradeDate}: ` +
        results.map((r) => `${r.symbol}=${r.action}`).join(', '),
    );
    return results;
  }

  /**
   * 09:00 UTC pass — force-close every auto position that is not down more than
   * 0.5%, and move the TP of the ones that are to break-even. Also reconciles
   * runs whose position already left the exchange (TP hit, or closed by hand).
   */
  async runReview(): Promise<AutoTradeAction[]> {
    const live = await this.runRepo.findLive();
    if (live.length === 0) return [];
    if (!this.client.isConfigured()) {
      this.logger.warn('Auto-trade review skipped: Bitget credentials not configured');
      return [];
    }
    if (this.running) {
      this.logger.warn('Auto-trade review skipped: another pass is still running');
      return [];
    }

    this.running = true;
    const results: AutoTradeAction[] = [];
    try {
      for (const run of live) {
        results.push(await this.reviewOne(run));
      }
    } finally {
      this.running = false;
    }
    this.logger.log(`Auto-trade review: ${results.map((r) => `${r.symbol}=${r.action}`).join(', ')}`);
    return results;
  }

  // ── per-coin steps ───────────────────────────────────────────────────────

  private async enterOne(symbol: string, tradeDate: string): Promise<AutoTradeAction> {
    const existing = await this.runRepo.findByDate(symbol, tradeDate);
    if (existing) {
      return {
        symbol,
        action: 'already-ran',
        detail: `Đã xử lý ${symbol} cho ngày ${tradeDate} (${existing.status}).`,
      };
    }

    const cfg = await this.longConfigOf(symbol);
    if (!cfg) {
      return this.recordSkip(symbol, tradeDate, 'Chưa cấu hình ký quỹ LONG cho coin này.');
    }

    // Never scale into a position the engine does not own — and never leave a
    // manual position exposed to the 09:00 force-close.
    const live = await this.client.getPosition(symbol, 'long').catch((err) => {
      this.logger.warn(`Auto-trade: cannot read ${symbol} position: ${(err as Error).message}`);
      return undefined;
    });
    if (live === undefined) {
      return this.recordFailure(symbol, tradeDate, 'Không đọc được vị thế hiện tại trên Bitget.');
    }
    if (live) {
      return this.recordSkip(
        symbol,
        tradeDate,
        `Đã có vị thế LONG mở (size ${fmtNum(Number(live.total))}) — bỏ qua ngày ${tradeDate}.`,
      );
    }

    try {
      const res = await this.bitget.openPosition({
        symbol,
        holdSide: 'long',
        marginUsd: cfg.marginUsd,
        leverage: cfg.leverage,
      });

      // Read the position back for the true average entry + exchange open time;
      // fall back to the ticker price the order was sized from.
      await sleep(TP_SETTLE_DELAY_MS);
      const pos = await this.client.getPosition(symbol, 'long').catch(() => null);
      const avg = pos ? Number(pos.openPriceAvg) : NaN;
      const entryPrice = Number.isFinite(avg) && avg > 0 ? avg : res.entryPrice;
      const cTime = pos ? Number(pos.cTime) : NaN;
      const openedAt = Number.isFinite(cTime) ? new Date(cTime) : new Date();
      const tpPrice = entryPrice * (1 + TP_PCT / 100);

      let tpSet = true;
      let tpNote = `TP +${TP_PCT}% @ ${fmtNum(tpPrice)}`;
      try {
        await this.bitget.setTpsl({
          symbol,
          holdSide: 'long',
          takeProfitPrice: tpPrice,
          stopLossPrice: null,
        });
      } catch (err) {
        tpSet = false;
        tpNote = `KHÔNG đặt được TP: ${(err as Error).message}`;
        this.logger.error(`Auto-trade: TP not set on ${symbol}: ${(err as Error).message}`);
      }

      const detail =
        `Vào LONG ${fmtNum(res.size)} @ ${fmtNum(entryPrice)} · ký quỹ $${cfg.marginUsd} · ` +
        `${res.leverage}× cross · ${tpNote}`;
      await this.runRepo.create({
        symbol,
        tradeDate,
        status: 'open',
        entryPrice,
        size: res.size,
        leverage: res.leverage,
        marginUsd: cfg.marginUsd,
        tpPrice: tpSet ? tpPrice : null,
        openedAt,
        detail,
      });
      this.logger.log(`Auto-trade opened ${symbol}: ${detail}`);
      return { symbol, action: 'opened', detail };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Auto-trade entry failed for ${symbol}: ${msg}`);
      return this.recordFailure(symbol, tradeDate, `Mở lệnh thất bại: ${msg}`);
    }
  }

  private async reviewOne(run: {
    id: string;
    symbol: string;
    status: string;
    entryPrice: number | null;
    openedAt: Date | null;
  }): Promise<AutoTradeAction> {
    const { symbol } = run;
    try {
      const pos = await this.client.getPosition(symbol, 'long');
      if (!pos) {
        const exitReason = run.status === 'extended' ? 'breakeven_hit' : 'tp_or_manual';
        await this.runRepo.update(run.id, {
          status: 'closed',
          exitReason,
          detail:
            run.status === 'extended'
              ? 'Vị thế đã đóng (TP hoà vốn khớp hoặc đóng tay).'
              : `Vị thế đã đóng trước 09:00 (TP +${TP_PCT}% khớp hoặc đóng tay).`,
          resolvedAt: new Date(),
        });
        return { symbol, action: 'gone', detail: 'Vị thế đã đóng trên sàn.' };
      }

      // Same position the engine opened? Bitget stamps cTime at fill, so a
      // different open time means the auto trade already closed and something
      // else is running on this coin — hands off.
      const cTime = Number(pos.cTime);
      if (
        run.openedAt &&
        Number.isFinite(cTime) &&
        Math.abs(cTime - run.openedAt.getTime()) > POSITION_MATCH_TOLERANCE_MS
      ) {
        await this.runRepo.update(run.id, {
          status: 'closed',
          exitReason: 'position_changed',
          detail:
            'Vị thế LONG đang mở KHÔNG phải lệnh của bot (mở lúc ' +
            `${new Date(cTime).toISOString()}) — bot không đụng vào.`,
          resolvedAt: new Date(),
        });
        return { symbol, action: 'gone', detail: 'Vị thế đang mở không phải của bot — bỏ qua.' };
      }

      const avg = Number(pos.openPriceAvg);
      const entry = Number.isFinite(avg) && avg > 0 ? avg : (run.entryPrice ?? NaN);
      const mark = Number(pos.markPrice);
      if (!Number.isFinite(entry) || !Number.isFinite(mark) || entry <= 0) {
        return { symbol, action: 'holding', detail: 'Thiếu giá entry/mark — bỏ qua lượt này.' };
      }
      const pnlPct = ((mark - entry) / entry) * 100;

      // Already extended on an earlier pass: the break-even TP is live on the
      // exchange and does the work — nothing left to decide here.
      if (run.status === 'extended') {
        return {
          symbol,
          action: 'holding',
          detail: `Đang gia hạn, chờ TP hoà vốn @ ${fmtNum(entry)} (hiện ${fmtPct(pnlPct)}).`,
        };
      }

      if (pnlPct >= KEEP_THRESHOLD_PCT) {
        await this.bitget.closePosition(symbol, 'long');
        const detail =
          `09:00 UTC: PnL ${fmtPct(pnlPct)} ≥ ${fmtPct(KEEP_THRESHOLD_PCT)} → chốt bắt buộc ` +
          `@ ${fmtNum(mark)} (entry ${fmtNum(entry)}).`;
        await this.runRepo.update(run.id, {
          status: 'closed',
          exitReason: 'forced_review',
          tpPrice: null,
          detail,
          resolvedAt: new Date(),
        });
        this.logger.log(`Auto-trade closed ${symbol}: ${detail}`);
        return { symbol, action: 'closed', detail };
      }

      // Down more than the threshold → keep it alive, exit at break-even. The
      // strategy sets no stop-loss, but `setTpsl` clears whatever it is not
      // given, so a stop the trader placed by hand is read back and re-sent.
      const liveSl = await this.liveStopLossOf(symbol);
      await this.bitget.setTpsl({
        symbol,
        holdSide: 'long',
        takeProfitPrice: entry,
        stopLossPrice: liveSl,
      });
      const detail =
        `09:00 UTC: PnL ${fmtPct(pnlPct)} < ${fmtPct(KEEP_THRESHOLD_PCT)} → gia hạn, ` +
        `TP dời về entry ${fmtNum(entry)}.`;
      await this.runRepo.update(run.id, {
        status: 'extended',
        tpPrice: entry,
        detail,
      });
      this.logger.log(`Auto-trade extended ${symbol}: ${detail}`);
      return { symbol, action: 'extended', detail };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Auto-trade review failed for ${symbol}: ${msg}`);
      // Leave the run live: the position is still on the exchange and the next
      // pass (or the trader) must still deal with it.
      await this.runRepo
        .update(run.id, { detail: `Lỗi lượt review 09:00: ${msg}` })
        .catch(() => undefined);
      return { symbol, action: 'failed', detail: msg };
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * The stop-loss currently live on the coin's LONG side, read from the pending
   * plan orders (newest wins). Null when none is set — or when the read fails,
   * in which case moving the TP does drop a manual stop; the alternative is
   * leaving the position without its break-even exit, which is worse.
   */
  private async liveStopLossOf(symbol: string): Promise<number | null> {
    try {
      const pending = await this.client.getPendingTpslOrders(symbol);
      const newest = pending
        .filter((o) => o.planType === 'pos_loss' && o.posSide === 'long')
        .sort((a, b) => Number(b.cTime) - Number(a.cTime))[0];
      const price = newest ? Number(newest.triggerPrice) : NaN;
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch (err) {
      this.logger.warn(`Auto-trade: cannot read live SL on ${symbol}: ${(err as Error).message}`);
      return null;
    }
  }

  /** The coin's saved LONG config, or null when it carries no usable margin. */
  private async longConfigOf(
    symbol: string,
  ): Promise<{ leverage: number; marginUsd: number } | null> {
    const rows = (await this.setupRepo.findAll()) as Array<{
      symbol: string;
      holdSide: string;
      leverage: number;
      marginUsd: number;
    }>;
    const row = rows.find((r) => r.symbol === symbol && r.holdSide === 'long');
    if (!row || !(row.marginUsd > 0)) return null;
    return { leverage: row.leverage, marginUsd: row.marginUsd };
  }

  private async recordSkip(
    symbol: string,
    tradeDate: string,
    detail: string,
  ): Promise<AutoTradeAction> {
    await this.runRepo
      .create({ symbol, tradeDate, status: 'skipped', detail, resolvedAt: new Date() })
      .catch(() => undefined);
    this.logger.log(`Auto-trade skipped ${symbol} (${tradeDate}): ${detail}`);
    return { symbol, action: 'skipped', detail };
  }

  private async recordFailure(
    symbol: string,
    tradeDate: string,
    detail: string,
  ): Promise<AutoTradeAction> {
    await this.runRepo
      .create({ symbol, tradeDate, status: 'failed', detail, resolvedAt: new Date() })
      .catch(() => undefined);
    return { symbol, action: 'failed', detail };
  }
}
