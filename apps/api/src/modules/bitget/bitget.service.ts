import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { summarizeBitgetClosed, type BitgetClosedSummary } from '@app/core';
import {
  createAssetCategoryRepository,
  createBitgetTradeJournalRepository,
  createBitgetTradeRepository,
} from '@app/db';

import { BitgetTradeClient, type BitgetRawPosition } from './bitget-trade.client';

/** The /my-asset bucket that holds the Bitget futures capital. */
const CAPITAL_CATEGORY_KEY = 'bitget';

/**
 * Fallback "vốn gốc" for when the `bitget` category has been deleted from
 * /my-asset. Capital normally comes from that bucket's ledger balance (in − out),
 * so it tracks deposits and withdrawals on its own — this constant only keeps
 * the old env override working for an install with no asset categories set up.
 */
const FALLBACK_CAPITAL_USD = Number(process.env.BITGET_INITIAL_CAPITAL_USD ?? 100);

/**
 * Equity vs the capital allocated to the exchange, in % — null when either number
 * is unusable. A capital of 0 (no transfers in yet) yields null rather than a
 * division by zero, so the tile shows "—" instead of Infinity.
 */
function equityChangePct(equity: number | undefined, capitalUsd: number): number | null {
  if (equity == null || !Number.isFinite(equity)) return null;
  if (!Number.isFinite(capitalUsd) || capitalUsd <= 0) return null;
  return ((equity - capitalUsd) / capitalUsd) * 100;
}

/** Canonical trade-session key — MUST match the worker/web (`symbol-holdSide-openedAt(ISO)`). */
function tradeKeyOf(symbol: string, holdSide: string, openedAtMs: number): string {
  return `${symbol}-${holdSide}-${new Date(openedAtMs).toISOString()}`;
}

/** Bitget sends '' for an unset TP/SL — normalize those to null. */
function toPrice(raw: string | null | undefined): number | null {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? n : null;
}

/** Compact number formatting for the system journal lines. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export type BitgetPosition = {
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  leverage: number;
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  breakEvenPrice: number | null;
  marginUsd: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  /** Return on the margin actually committed (ROE %), the number the exchange shows. */
  roePct: number;
  realizedPnlUsd: number;
  /** Position take-profit trigger set on the exchange, or null when none is set. */
  takeProfitPrice: number | null;
  /** Position stop-loss trigger set on the exchange, or null when none is set. */
  stopLossPrice: number | null;
  /** When the position was opened (Bitget cTime). Anchors the trade-journal tradeKey. */
  openedAt: string | null;
  updatedAt: string | null;
};

export type BitgetPositionsResult = {
  configured: boolean;
  positions: BitgetPosition[];
  totalUnrealizedPnlUsd: number;
  totalMarginUsd: number;
  /** Total wallet equity (balance + unrealized PnL), USDT. Null if unavailable. */
  accountEquityUsd: number | null;
  /** Capital the account started from, USDT — the baseline for `equityChangePct`. */
  initialCapitalUsd: number;
  /** Equity vs initial capital, in % (+/-). Null when equity is unavailable. */
  equityChangePct: number | null;
  fetchedAt: string;
};

export type BitgetClosedTrade = {
  positionId: string;
  /** Stable trade-session key — lets the history tab open the trade's journal. */
  tradeKey: string;
  status: 'closed';
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  openAvgPrice: number;
  closeAvgPrice: number;
  size: number;
  netProfit: number;
  /** Return on notional (netProfit ÷ entry notional), in %. */
  netProfitPct: number;
  totalFunding: number;
  feesUsd: number;
  openedAt: string;
  closedAt: string;
};

export type BitgetHistoryResult = {
  configured: boolean;
  trades: BitgetClosedTrade[];
  summary: BitgetClosedSummary;
  fetchedAt: string;
};

@Injectable()
export class BitgetService {
  private readonly logger = new Logger(BitgetService.name);
  private readonly client = new BitgetTradeClient();
  private readonly tradeRepo = createBitgetTradeRepository();
  private readonly journalRepo = createBitgetTradeJournalRepository();
  private readonly assetCategoryRepo = createAssetCategoryRepository();

  async getOpenPositions(): Promise<BitgetPositionsResult> {
    const fetchedAt = new Date().toISOString();
    const initialCapitalUsd = await this.capitalUsd();

    if (!this.client.isConfigured()) {
      return {
        configured: false,
        positions: [],
        totalUnrealizedPnlUsd: 0,
        totalMarginUsd: 0,
        accountEquityUsd: null,
        initialCapitalUsd,
        equityChangePct: null,
        fetchedAt,
      };
    }

    let raw: BitgetRawPosition[] = [];
    try {
      raw = await this.client.getAllPositions();
    } catch (err) {
      this.logger.warn(`Failed to fetch Bitget positions: ${(err as Error).message}`);
      throw err;
    }

    // Wallet balance is non-fatal — a failure here shouldn't blank the positions table.
    const balance = await this.client.getAccountBalance().catch((err) => {
      this.logger.warn(`Failed to fetch Bitget account balance: ${(err as Error).message}`);
      return null;
    });

    const positions = raw
      .map((p) => this.mapPosition(p))
      .sort((a, b) => Math.abs(b.notionalUsd) - Math.abs(a.notionalUsd));

    const totalUnrealizedPnlUsd = positions.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0);
    const totalMarginUsd = positions.reduce((sum, p) => sum + p.marginUsd, 0);

    return {
      configured: true,
      positions,
      totalUnrealizedPnlUsd,
      totalMarginUsd,
      accountEquityUsd: balance?.accountEquity ?? null,
      initialCapitalUsd,
      equityChangePct: equityChangePct(balance?.accountEquity, initialCapitalUsd),
      fetchedAt,
    };
  }

  /**
   * Capital allocated to Bitget = everything transferred/deposited into the
   * `bitget` bucket on /my-asset minus everything taken out. Falls back to the
   * env constant only when that category is missing entirely; a ledger that
   * legitimately nets to 0 stays 0.
   */
  private async capitalUsd(): Promise<number> {
    try {
      const balance = await this.assetCategoryRepo.balanceByKey(CAPITAL_CATEGORY_KEY);
      return balance ?? FALLBACK_CAPITAL_USD;
    } catch (err) {
      // Non-fatal, same as the balance fetch: a DB hiccup must not blank the table.
      this.logger.warn(`Failed to read Bitget capital from /my-asset: ${(err as Error).message}`);
      return FALLBACK_CAPITAL_USD;
    }
  }

  /**
   * Closed-trade history + realized-PnL summary, read from the DB (the worker
   * mirrors Bitget's 90-day window into `bitget_closed_positions` on a cron).
   * `configured` reflects whether the same account credentials the worker syncs
   * with are present, so the page can explain an empty list.
   */
  async getClosedHistory(limit = 200, symbol?: string): Promise<BitgetHistoryResult> {
    const fetchedAt = new Date().toISOString();
    const rows = await this.tradeRepo.findRecentClosed(limit, symbol);

    const trades: BitgetClosedTrade[] = rows.map((r) => {
      const notional = Math.abs(r.openAvgPrice * r.openTotalPos);
      const netProfit = r.netProfit ?? 0;
      return {
        positionId: r.positionId ?? '',
        tradeKey: r.tradeKey,
        status: 'closed',
        symbol: r.symbol,
        holdSide: r.holdSide === 'short' ? 'short' : 'long',
        marginMode: r.marginMode,
        openAvgPrice: r.openAvgPrice,
        closeAvgPrice: r.closeAvgPrice ?? 0,
        size: r.openTotalPos,
        netProfit,
        netProfitPct: notional > 0 ? (netProfit / notional) * 100 : 0,
        totalFunding: r.totalFunding ?? 0,
        feesUsd: (r.openFee ?? 0) + (r.closeFee ?? 0),
        openedAt: r.openedAt.toISOString(),
        closedAt: (r.closedAt ?? r.openedAt).toISOString(),
      };
    });

    // summarizeBitgetClosed needs non-null netProfit — closed rows always have it.
    const summary = summarizeBitgetClosed(
      rows.map((r) => ({
        symbol: r.symbol,
        netProfit: r.netProfit ?? 0,
        openAvgPrice: r.openAvgPrice,
        openTotalPos: r.openTotalPos,
      })),
    );

    return { configured: this.client.isConfigured(), trades, summary, fetchedAt };
  }

  /**
   * Force-close a live position at market (reduce-only). Reads the current size
   * first so an already-flat side returns 409 (nothing to close) instead of a
   * confusing exchange error. Throws 503 when credentials are missing or the
   * exchange call fails — never report success while the position may be open.
   */
  async closePosition(
    symbol: string,
    holdSide: 'long' | 'short',
  ): Promise<{ closed: true; symbol: string; holdSide: 'long' | 'short' }> {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('Bitget credentials not configured — cannot close a position');
    }
    try {
      const size = await this.client.getPositionSize(symbol, holdSide);
      if (size <= 0) {
        throw new ConflictException('Vị thế đã đóng trên sàn — không còn gì để đóng.');
      }
      await this.client.closePosition(symbol, holdSide);
      this.logger.log(`Force-closed Bitget position at market: ${symbol} ${holdSide} (size ${size})`);
      return { closed: true, symbol, holdSide };
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to force-close ${symbol} ${holdSide}: ${msg}`);
      throw new ServiceUnavailableException(`Không đóng được vị thế trên Bitget: ${msg}`);
    }
  }

  /**
   * Open a market position in cross margin from the Setup tab, or ADD volume to
   * the one already open on that coin+side. Derives the base-asset size from the
   * requested margin × leverage ÷ live price (floored to the contract's
   * precision), then places a market order with no preset TP/SL.
   *
   * When the side is already open this scales in instead of rejecting: the
   * exchange leverage of the live position wins (Bitget refuses leverage changes
   * while a position is open), and the add-on is written to the trade's journal
   * as a `system` note so the timeline records how the position was built.
   */
  async openPosition(input: {
    symbol: string;
    holdSide: 'long' | 'short';
    marginUsd: number;
    leverage: number;
  }): Promise<{
    opened: true;
    /** 'new' = fresh position, 'add' = volume added to an already-open one. */
    mode: 'new' | 'add';
    symbol: string;
    holdSide: 'long' | 'short';
    /** Size just placed (the added amount when scaling in). */
    size: number;
    /** Total position size after this order (= `size` for a fresh position). */
    totalSize: number;
    entryPrice: number;
    /** Leverage actually used — the live position's when adding to it. */
    leverage: number;
    marginUsd: number;
  }> {
    const { symbol, holdSide, marginUsd } = input;
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('Bitget credentials not configured — cannot open a position');
    }
    if (!(marginUsd > 0)) throw new BadRequestException('Ký quỹ phải lớn hơn 0.');
    if (!(input.leverage >= 1)) throw new BadRequestException('Đòn bẩy phải ≥ 1.');

    try {
      const existing = await this.client.getPosition(symbol, holdSide);
      const existingSize = existing ? Number(existing.total) : 0;
      const isAdd = existingSize > 0;
      // Adding: Bitget keeps the position's own leverage (it refuses changes while
      // open), so size the add-on with that instead of the configured value.
      const existingLeverage = existing ? Number(existing.leverage) : NaN;
      const leverage = isAdd && Number.isFinite(existingLeverage) && existingLeverage >= 1
        ? existingLeverage
        : input.leverage;

      const [price, spec] = await Promise.all([
        this.client.getTickerPrice(symbol),
        this.client.getContractSpec(symbol),
      ]);

      // notional = margin × leverage; size (base asset) = notional ÷ price, floored
      // to the contract's volume precision so Bitget doesn't reject it.
      const rawSize = (marginUsd * leverage) / price;
      const factor = 10 ** spec.volumePlace;
      const size = Math.floor(rawSize * factor) / factor;
      if (size < spec.minTradeNum || size <= 0) {
        throw new BadRequestException(
          `Ký quỹ quá nhỏ: size ${size} < tối thiểu ${spec.minTradeNum} ${symbol}. Tăng ký quỹ hoặc đòn bẩy.`,
        );
      }

      // Leverage is only settable while flat — skip it entirely when adding.
      if (!isAdd) await this.client.setCrossLeverage(symbol, holdSide, leverage);
      const clientOid = `manual-${symbol}-${holdSide}-${Date.now()}`;
      await this.client.openMarketPosition({
        symbol,
        holdSide,
        size: size.toFixed(spec.volumePlace),
        clientOid,
      });

      const totalSize = existingSize + size;
      this.logger.log(
        `${isAdd ? 'Added volume to' : 'Opened'} Bitget market position: ${holdSide} ${symbol} ` +
          `size ${size}${isAdd ? ` (was ${existingSize} → ${totalSize})` : ''} @~${price} ` +
          `(margin $${marginUsd}, ${leverage}x cross)`,
      );

      if (isAdd && existing) {
        await this.writeSystemLog(existing, [
          `➕ **Thêm volume vào lệnh** ${holdSide === 'short' ? 'SHORT' : 'LONG'} ${symbol}`,
          `- Size thêm: ${fmtNum(size)} (ký quỹ $${fmtNum(marginUsd)} · ${leverage}× cross)`,
          `- Giá market khi thêm: ${fmtNum(price)}`,
          `- Size: ${fmtNum(existingSize)} → ${fmtNum(totalSize)}`,
        ].join('\n'), { entryPrice: Number(existing.openPriceAvg), markPrice: price });
      }

      return {
        opened: true,
        mode: isAdd ? 'add' : 'new',
        symbol,
        holdSide,
        size,
        totalSize,
        entryPrice: price,
        leverage,
        marginUsd,
      };
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to open ${holdSide} ${symbol}: ${msg}`);
      throw new ServiceUnavailableException(`Không mở được vị thế trên Bitget: ${msg}`);
    }
  }

  /**
   * Set (or clear) the position-level take-profit / stop-loss on the exchange so
   * BITGET closes the position when a trigger is hit — this app being down must
   * never matter. `null` clears that side; `undefined` is not accepted (the
   * dialog always sends both fields, so a missing one is an explicit clear).
   *
   * Order of operations is deliberately place-then-cleanup: the new trigger is
   * live on the exchange before any older duplicate plan order is cancelled, so
   * the position is never left unprotected mid-update.
   */
  async setTpsl(input: {
    symbol: string;
    holdSide: 'long' | 'short';
    takeProfitPrice: number | null;
    stopLossPrice: number | null;
  }): Promise<{
    ok: true;
    symbol: string;
    holdSide: 'long' | 'short';
    takeProfitPrice: number | null;
    stopLossPrice: number | null;
  }> {
    const { symbol, holdSide } = input;
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('Bitget credentials not configured — cannot set TP/SL');
    }

    try {
      const position = await this.client.getPosition(symbol, holdSide);
      if (!position) {
        throw new ConflictException('Vị thế đã đóng trên sàn — không đặt được TP/SL.');
      }

      const spec = await this.client.getContractSpec(symbol);
      const markPrice = Number(position.markPrice);
      const round = (n: number) => Number(n.toFixed(spec.pricePlace));
      const tp = input.takeProfitPrice != null ? round(input.takeProfitPrice) : null;
      const sl = input.stopLossPrice != null ? round(input.stopLossPrice) : null;
      this.assertTpslDirection(holdSide, markPrice, tp, sl);

      // NOTE: `single-position` returns null TP/SL even when triggers exist (only
      // `all-position` fills those fields), so read the levels being replaced from
      // the pending plan orders themselves. Best-effort — used for the log line only.
      const [prevTp, prevSl] = await this.readLiveTpsl(symbol, holdSide);

      if (tp != null || sl != null) {
        await this.client.placePositionTpsl({
          symbol,
          holdSide,
          takeProfitPrice: tp != null ? tp.toFixed(spec.pricePlace) : undefined,
          stopLossPrice: sl != null ? sl.toFixed(spec.pricePlace) : undefined,
        });
      }

      // Cleanup: keep only the newest position TP and SL for this side, and drop
      // the ones the trader just cleared. Non-fatal — a leftover duplicate is
      // worth a warning, not a failed request after the trigger is already live.
      await this.cleanupTpslOrders(symbol, holdSide, { keepTp: tp != null, keepSl: sl != null });

      this.logger.log(
        `Set Bitget TP/SL for ${holdSide} ${symbol}: TP ${tp ?? 'none'} (was ${prevTp ?? 'none'}), ` +
          `SL ${sl ?? 'none'} (was ${prevSl ?? 'none'})`,
      );
      await this.writeSystemLog(position, [
        `🎯 **Cập nhật TP/SL** ${holdSide === 'short' ? 'SHORT' : 'LONG'} ${symbol}`,
        `- Take Profit: ${tp != null ? fmtNum(tp) : 'đã xoá'}${prevTp != null ? ` (trước: ${fmtNum(prevTp)})` : ''}`,
        `- Stop Loss: ${sl != null ? fmtNum(sl) : 'đã xoá'}${prevSl != null ? ` (trước: ${fmtNum(prevSl)})` : ''}`,
        `- Giá hiện tại: ${fmtNum(markPrice)} · kích hoạt theo Mark Price, đóng toàn bộ vị thế`,
      ].join('\n'), { entryPrice: Number(position.openPriceAvg), markPrice });

      return { ok: true, symbol, holdSide, takeProfitPrice: tp, stopLossPrice: sl };
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to set TP/SL for ${holdSide} ${symbol}: ${msg}`);
      throw new ServiceUnavailableException(`Không đặt được TP/SL trên Bitget: ${msg}`);
    }
  }

  /**
   * The TP/SL currently live on the exchange for one side, read from the pending
   * position plan orders (newest wins). `[null, null]` when none are set or the
   * lookup fails — this only feeds the journal's "trước: …" annotation.
   */
  private async readLiveTpsl(
    symbol: string,
    holdSide: 'long' | 'short',
  ): Promise<[number | null, number | null]> {
    try {
      const pending = await this.client.getPendingTpslOrders(symbol);
      const newest = (planType: string) =>
        pending
          .filter((o) => o.planType === planType && o.posSide === holdSide)
          .sort((a, b) => Number(b.cTime) - Number(a.cTime))[0];
      return [toPrice(newest('pos_profit')?.triggerPrice), toPrice(newest('pos_loss')?.triggerPrice)];
    } catch {
      return [null, null];
    }
  }

  /**
   * A long takes profit above and stops out below the current price (a short is
   * mirrored). Bitget rejects the inverse itself, but with an opaque error code —
   * catching it here keeps the message readable and avoids a wasted round trip.
   */
  private assertTpslDirection(
    holdSide: 'long' | 'short',
    markPrice: number,
    tp: number | null,
    sl: number | null,
  ): void {
    if (tp != null && !(tp > 0)) throw new BadRequestException('Giá Take Profit phải lớn hơn 0.');
    if (sl != null && !(sl > 0)) throw new BadRequestException('Giá Stop Loss phải lớn hơn 0.');
    if (!Number.isFinite(markPrice) || markPrice <= 0) return;

    const isLong = holdSide === 'long';
    if (tp != null && (isLong ? tp <= markPrice : tp >= markPrice)) {
      throw new BadRequestException(
        `Take Profit phải ${isLong ? 'cao hơn' : 'thấp hơn'} giá hiện tại (${fmtNum(markPrice)}).`,
      );
    }
    if (sl != null && (isLong ? sl >= markPrice : sl <= markPrice)) {
      throw new BadRequestException(
        `Stop Loss phải ${isLong ? 'thấp hơn' : 'cao hơn'} giá hiện tại (${fmtNum(markPrice)}).`,
      );
    }
  }

  /**
   * Leave exactly one live position-TP and one position-SL for the side: the
   * newest of each when it was just (re)placed, none when it was cleared. Bitget
   * may either replace or stack a second plan order when `place-pos-tpsl` runs
   * over an existing trigger — this makes both behaviours converge.
   */
  private async cleanupTpslOrders(
    symbol: string,
    holdSide: 'long' | 'short',
    keep: { keepTp: boolean; keepSl: boolean },
  ): Promise<void> {
    try {
      const pending = await this.client.getPendingTpslOrders(symbol);
      for (const planType of ['pos_profit', 'pos_loss'] as const) {
        const keepNewest = planType === 'pos_profit' ? keep.keepTp : keep.keepSl;
        const rows = pending
          .filter((o) => o.planType === planType && o.posSide === holdSide)
          .sort((a, b) => Number(b.cTime) - Number(a.cTime));
        // Newest survives when the trigger is meant to stay; everything else goes.
        const stale = keepNewest ? rows.slice(1) : rows;
        for (const o of stale) {
          await this.client.cancelPlanOrder(symbol, o.orderId, planType);
          this.logger.log(`Cancelled stale ${planType} plan order ${o.orderId} on ${symbol} ${holdSide}`);
        }
      }
    } catch (err) {
      this.logger.warn(
        `TP/SL cleanup failed for ${symbol} ${holdSide}: ${(err as Error).message}. ` +
          'A stale plan order may still be live on the exchange.',
      );
    }
  }

  /**
   * Append a read-only `system` note to the position's journal timeline, keyed by
   * the same tradeKey the worker and web use. Best-effort: a logging failure must
   * never fail the trade action that produced it.
   */
  private async writeSystemLog(
    position: BitgetRawPosition,
    content: string,
    snapshot: { entryPrice?: number; markPrice?: number },
  ): Promise<void> {
    const openedAtMs = Number(position.cTime);
    if (!Number.isFinite(openedAtMs)) return;
    await this.journalRepo
      .create({
        tradeKey: tradeKeyOf(position.symbol, position.holdSide, openedAtMs),
        kind: 'system',
        symbol: position.symbol,
        holdSide: position.holdSide,
        content,
        snapshot: {
          ...(Number.isFinite(snapshot.entryPrice) ? { entryPrice: snapshot.entryPrice } : {}),
          ...(Number.isFinite(snapshot.markPrice) ? { markPrice: snapshot.markPrice } : {}),
        },
      })
      .catch((err) => this.logger.warn(`Failed to write system journal log: ${(err as Error).message}`));
  }

  private mapPosition(p: BitgetRawPosition): BitgetPosition {
    const size = Number(p.total);
    const entryPrice = Number(p.openPriceAvg);
    const markPrice = Number(p.markPrice);
    const marginUsd = Number(p.marginSize);
    const unrealizedPnlUsd = Number(p.unrealizedPL);
    const leverage = Number(p.leverage);
    const liquidationPrice = Number(p.liquidationPrice);
    const breakEvenPrice = Number(p.breakEvenPrice);

    return {
      symbol: p.symbol,
      holdSide: p.holdSide,
      marginMode: p.marginMode,
      leverage: Number.isFinite(leverage) ? leverage : 0,
      size,
      entryPrice,
      markPrice,
      liquidationPrice: Number.isFinite(liquidationPrice) && liquidationPrice > 0 ? liquidationPrice : null,
      breakEvenPrice: Number.isFinite(breakEvenPrice) && breakEvenPrice > 0 ? breakEvenPrice : null,
      marginUsd,
      notionalUsd: size * markPrice,
      unrealizedPnlUsd,
      roePct: marginUsd > 0 ? (unrealizedPnlUsd / marginUsd) * 100 : 0,
      realizedPnlUsd: Number(p.achievedProfits),
      takeProfitPrice: toPrice(p.takeProfit),
      stopLossPrice: toPrice(p.stopLoss),
      openedAt: p.cTime ? new Date(Number(p.cTime)).toISOString() : null,
      updatedAt: p.uTime ? new Date(Number(p.uTime)).toISOString() : null,
    };
  }
}
