import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { summarizeOkxClosed, type OkxClosedSummary } from '@app/core';
import {
  createAssetCategoryRepository,
  createOkxTradeJournalRepository,
  createOkxTradeRepository,
} from '@app/db';

import {
  OkxTradeClient,
  buildClOrdId,
  type OkxAlgoOrder,
  type OkxRawPosition,
} from './okx-trade.client';

/** The /my-asset bucket that holds the OKX futures capital. */
const CAPITAL_CATEGORY_KEY = 'okx';

/**
 * Fallback "vốn gốc" for when the `okx` category has been deleted from
 * /my-asset. Capital normally comes from that bucket's ledger balance (in − out),
 * so it tracks deposits and withdrawals on its own — this constant only keeps
 * the old env override working for an install with no asset categories set up.
 */
const FALLBACK_CAPITAL_USD = Number(process.env.OKX_INITIAL_CAPITAL_USD ?? 100);

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

/**
 * OKX algo orders carry no position id, so a live TP/SL is matched back to its
 * position by symbol + side instead.
 */
function tpslKeyOf(symbol: string, holdSide: string): string {
  return `${symbol}-${holdSide}`;
}

/** Compact number formatting for the system journal lines. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export type OkxPosition = {
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
  /** When the position was opened (OKX cTime). Anchors the trade-journal tradeKey. */
  openedAt: string | null;
  updatedAt: string | null;
};

export type OkxPositionsResult = {
  configured: boolean;
  positions: OkxPosition[];
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

export type OkxClosedTrade = {
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

export type OkxHistoryResult = {
  configured: boolean;
  trades: OkxClosedTrade[];
  summary: OkxClosedSummary;
  fetchedAt: string;
};

@Injectable()
export class OkxService {
  private readonly logger = new Logger(OkxService.name);
  private readonly client = new OkxTradeClient();
  private readonly tradeRepo = createOkxTradeRepository();
  private readonly journalRepo = createOkxTradeJournalRepository();
  private readonly assetCategoryRepo = createAssetCategoryRepository();

  async getOpenPositions(): Promise<OkxPositionsResult> {
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

    let raw: OkxRawPosition[] = [];
    try {
      raw = await this.client.getAllPositions();
    } catch (err) {
      this.logger.warn(`Failed to fetch OKX positions: ${(err as Error).message}`);
      throw err;
    }

    // Both are non-fatal — a failure here shouldn't blank the positions table.
    // Unlike MEXC, OKX position rows carry their own `markPx`, so no extra price
    // call is needed; only the TP/SL algo orders have to be read separately.
    const [balance, tpsl] = await Promise.all([
      this.client.getAccountBalance().catch((err) => {
        this.logger.warn(`Failed to fetch OKX account balance: ${(err as Error).message}`);
        return null;
      }),
      this.readAllTpsl(raw).catch(() => new Map<string, { tp: number | null; sl: number | null }>()),
    ]);

    const positions = raw
      .map((p) => this.mapPosition(p, tpsl.get(tpslKeyOf(p.symbol, p.holdSide))))
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
   * Capital allocated to OKX = everything transferred/deposited into the `okx`
   * bucket on /my-asset minus everything taken out. Falls back to the env
   * constant only when that category is missing entirely; a ledger that
   * legitimately nets to 0 stays 0.
   */
  private async capitalUsd(): Promise<number> {
    try {
      const balance = await this.assetCategoryRepo.balanceByKey(CAPITAL_CATEGORY_KEY);
      return balance ?? FALLBACK_CAPITAL_USD;
    } catch (err) {
      // Non-fatal, same as the balance fetch: a DB hiccup must not blank the table.
      this.logger.warn(`Failed to read OKX capital from /my-asset: ${(err as Error).message}`);
      return FALLBACK_CAPITAL_USD;
    }
  }

  /**
   * Closed-trade history + realized-PnL summary, read from the DB (the worker
   * mirrors OKX's closed positions into `okx_trades` on a cron). `configured`
   * reflects whether the same account credentials the worker syncs with are
   * present, so the page can explain an empty list.
   */
  async getClosedHistory(limit = 200, symbol?: string): Promise<OkxHistoryResult> {
    const fetchedAt = new Date().toISOString();
    const rows = await this.tradeRepo.findRecentClosed(limit, symbol);

    const trades: OkxClosedTrade[] = rows.map((r) => {
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

    const summary = summarizeOkxClosed(
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
   * Force-close a live position at market (OKX's own `close-position`
   * endpoint). Reads the position first so an already-flat side returns 409
   * (nothing to close) instead of a confusing exchange error. Throws 503 when
   * credentials are missing or the exchange call fails — never report success
   * while the position may be open.
   */
  async closePosition(
    symbol: string,
    holdSide: 'long' | 'short',
  ): Promise<{ closed: true; symbol: string; holdSide: 'long' | 'short' }> {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('OKX credentials not configured — cannot close a position');
    }
    try {
      const position = await this.client.getPosition(symbol, holdSide);
      if (!position || position.pos <= 0) {
        throw new ConflictException('Vị thế đã đóng trên sàn — không còn gì để đóng.');
      }
      await this.client.closePosition(position);
      this.logger.log(`Force-closed OKX position at market: ${symbol} ${holdSide} (size ${position.size})`);
      return { closed: true, symbol, holdSide };
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to force-close ${symbol} ${holdSide}: ${msg}`);
      throw new ServiceUnavailableException(`Không đóng được vị thế trên OKX: ${msg}`);
    }
  }

  /**
   * Open a market position in cross margin from the Setup tab, or ADD volume to
   * the one already open on that coin+side. Derives the contract size from the
   * requested margin × leverage ÷ live price ÷ ctVal (floored to the
   * instrument's `lotSz`), then places a market order with no preset TP/SL.
   *
   * When the side is already open this scales in instead of rejecting: the
   * exchange leverage of the live position wins, and the add-on is written to
   * the trade's journal as a `system` note so the timeline records how the
   * position was built.
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
    /** Size just placed, in the base asset (the added amount when scaling in). */
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
      throw new ServiceUnavailableException('OKX credentials not configured — cannot open a position');
    }
    if (!(marginUsd > 0)) throw new BadRequestException('Ký quỹ phải lớn hơn 0.');
    if (!(input.leverage >= 1)) throw new BadRequestException('Đòn bẩy phải ≥ 1.');

    try {
      const existing = await this.client.getPosition(symbol, holdSide);
      const existingSize = existing ? existing.size : 0;
      const isAdd = existingSize > 0;
      // Adding: keep the live position's own leverage — changing it under an open
      // position rebases the margin of the whole position on OKX, so sizing the
      // add-on with the configured value would misstate the notional.
      const existingLeverage = existing ? existing.leverage : NaN;
      const leverage =
        isAdd && Number.isFinite(existingLeverage) && existingLeverage >= 1 ? existingLeverage : input.leverage;

      const [price, spec] = await Promise.all([
        this.client.getTickerPrice(symbol),
        this.client.getInstrumentSpec(symbol),
      ]);
      if (!spec.live) {
        throw new BadRequestException(`OKX không cho phép giao dịch ${symbol} lúc này (hợp đồng không "live").`);
      }

      // notional = margin × leverage; base size = notional ÷ price; contracts =
      // base size ÷ ctVal, floored to a whole `lotSz` step so OKX accepts it.
      const baseSize = (marginUsd * leverage) / price;
      const rawSz = baseSize / spec.ctVal;
      const steps = Math.floor(rawSz / spec.lotSz);
      // Re-round the multiplication so float noise can't produce 0.30000000000000004.
      const sz = Number((steps * spec.lotSz).toFixed(Math.max(0, scaleOfNumber(spec.lotSz))));
      if (sz < spec.minSz || sz <= 0) {
        throw new BadRequestException(
          `Ký quỹ quá nhỏ: ${sz} hợp đồng < tối thiểu ${spec.minSz} cho ${symbol}. Tăng ký quỹ hoặc đòn bẩy.`,
        );
      }
      const size = sz * spec.ctVal;

      // Leverage is only set on a fresh position — changing it under a live one
      // would rebase the margin of everything already open.
      if (!isAdd) await this.client.setCrossLeverage(symbol, holdSide, leverage);
      const clOrdId = buildClOrdId(symbol, holdSide);
      await this.client.openMarketPosition({ symbol, holdSide, sz, clOrdId });

      const totalSize = existingSize + size;
      this.logger.log(
        `${isAdd ? 'Added volume to' : 'Opened'} OKX market position: ${holdSide} ${symbol} ` +
          `size ${size} (${sz} contracts)${isAdd ? ` (was ${existingSize} → ${totalSize})` : ''} @~${price} ` +
          `(margin $${marginUsd}, ${leverage}x cross)`,
      );

      if (isAdd && existing) {
        await this.writeSystemLog(
          existing,
          [
            `➕ **Thêm volume vào lệnh** ${holdSide === 'short' ? 'SHORT' : 'LONG'} ${symbol}`,
            `- Size thêm: ${fmtNum(size)} (ký quỹ $${fmtNum(marginUsd)} · ${leverage}× cross)`,
            `- Giá market khi thêm: ${fmtNum(price)}`,
            `- Size: ${fmtNum(existingSize)} → ${fmtNum(totalSize)}`,
          ].join('\n'),
          { entryPrice: existing.avgPx, markPrice: price },
        );
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
      throw new ServiceUnavailableException(`Không mở được vị thế trên OKX: ${msg}`);
    }
  }

  /**
   * Set (or clear) the position-level take-profit / stop-loss on the exchange so
   * OKX closes the position when a trigger is hit — this app being down must
   * never matter. `null` clears that side.
   *
   * On OKX a TP/SL is an ALGO ORDER, not a field on the position, and several can
   * coexist on the same instrument. The dashboard's contract is "one position
   * TP/SL", so an update replaces whatever is live rather than stacking a second
   * trigger — see `replaceTpsl`.
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
      throw new ServiceUnavailableException('OKX credentials not configured — cannot set TP/SL');
    }

    try {
      const position = await this.client.getPosition(symbol, holdSide);
      if (!position) {
        throw new ConflictException('Vị thế đã đóng trên sàn — không đặt được TP/SL.');
      }

      const spec = await this.client.getInstrumentSpec(symbol);
      const markPrice = position.markPx || position.avgPx;
      const round = (n: number) => Number(n.toFixed(spec.priceScale));
      const tp = input.takeProfitPrice != null ? round(input.takeProfitPrice) : null;
      const sl = input.stopLossPrice != null ? round(input.stopLossPrice) : null;
      this.assertTpslDirection(holdSide, markPrice, tp, sl);

      // The levels being replaced, for the journal line only (best-effort).
      const existing = await this.readLiveTpslOrders(symbol, holdSide);
      const prevTp = existing.find((o) => o.takeProfitPrice != null)?.takeProfitPrice ?? null;
      const prevSl = existing.find((o) => o.stopLossPrice != null)?.stopLossPrice ?? null;

      if (tp == null && sl == null) {
        // Clearing both sides: nothing to place, just drop what is live.
        await this.cancelTpslOrders(existing);
      } else if (existing.length > 0) {
        await this.replaceTpsl(position, existing, tp, sl);
      } else {
        await this.client.placePositionTpsl({
          position,
          takeProfitPrice: tp ?? undefined,
          stopLossPrice: sl ?? undefined,
        });
      }

      this.logger.log(
        `Set OKX TP/SL for ${holdSide} ${symbol}: TP ${tp ?? 'none'} (was ${prevTp ?? 'none'}), ` +
          `SL ${sl ?? 'none'} (was ${prevSl ?? 'none'})`,
      );
      await this.writeSystemLog(
        position,
        [
          `🎯 **Cập nhật TP/SL** ${holdSide === 'short' ? 'SHORT' : 'LONG'} ${symbol}`,
          `- Take Profit: ${tp != null ? fmtNum(tp) : 'đã xoá'}${prevTp != null ? ` (trước: ${fmtNum(prevTp)})` : ''}`,
          `- Stop Loss: ${sl != null ? fmtNum(sl) : 'đã xoá'}${prevSl != null ? ` (trước: ${fmtNum(prevSl)})` : ''}`,
          `- Giá hiện tại: ${fmtNum(markPrice)} · kích hoạt theo Mark Price, đóng toàn bộ vị thế`,
        ].join('\n'),
        { entryPrice: position.avgPx, markPrice },
      );

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
      throw new ServiceUnavailableException(`Không đặt được TP/SL trên OKX: ${msg}`);
    }
  }

  /**
   * Update the TP/SL of a position that ALREADY has a live algo order. Amending
   * the live order in place keeps the position protected throughout, which is why
   * it is tried first.
   *
   * Cancel-then-place is the fallback, used when the in-place path cannot work: a
   * side is being cleared or added (amend only changes prices that are already on
   * the order), more than one order is live, or the amend call fails.
   */
  private async replaceTpsl(
    position: OkxRawPosition,
    existing: OkxAlgoOrder[],
    tp: number | null,
    sl: number | null,
  ): Promise<void> {
    const current = existing[0];
    // Amend can only move a trigger that is already on the order — a side being
    // added or removed changes the order's shape and needs a replace.
    const changesShape =
      current != null &&
      ((tp == null) !== (current.takeProfitPrice == null) || (sl == null) !== (current.stopLossPrice == null));

    if (current != null && existing.length === 1 && !changesShape) {
      try {
        await this.client.amendPositionTpsl({
          instId: current.instId,
          algoId: current.algoId,
          takeProfitPrice: tp ?? undefined,
          stopLossPrice: sl ?? undefined,
        });
        return;
      } catch (err) {
        this.logger.warn(
          `In-place TP/SL update failed for ${position.holdSide} ${position.symbol}: ` +
            `${(err as Error).message}. Falling back to cancel-then-place.`,
        );
      }
    }

    // Fatal on purpose: if the old order survives, the position would end up with
    // two competing triggers and the user must see why rather than get a silent
    // duplicate.
    await this.client.cancelTpslOrders(existing);
    await this.client.placePositionTpsl({
      position,
      takeProfitPrice: tp ?? undefined,
      stopLossPrice: sl ?? undefined,
    });
  }

  /** Live TP/SL algo orders attached to one position. `[]` when none or on failure. */
  private async readLiveTpslOrders(symbol: string, holdSide: 'long' | 'short'): Promise<OkxAlgoOrder[]> {
    try {
      const pending = await this.client.getPendingTpslOrders(symbol);
      return pending.filter((o) => o.holdSide === holdSide).sort((a, b) => b.createTime - a.createTime);
    } catch {
      return [];
    }
  }

  /** Cancel superseded TP/SL orders; a failure only warns (see `setTpsl`). */
  private async cancelTpslOrders(orders: OkxAlgoOrder[]): Promise<void> {
    if (orders.length === 0) return;
    try {
      await this.client.cancelTpslOrders(orders);
      this.logger.log(`Cancelled ${orders.length} superseded OKX TP/SL order(s)`);
    } catch (err) {
      this.logger.warn(
        `TP/SL cleanup failed: ${(err as Error).message}. A stale trigger may still be live on the exchange.`,
      );
    }
  }

  /**
   * Every position's live TP/SL, keyed by `symbol-holdSide` — one call per
   * distinct symbol so the positions table can show the triggers OKX holds. They
   * are algo orders rather than fields on the position row (as on Bitget), and
   * they carry no position id, so symbol + side is the only join available.
   */
  private async readAllTpsl(
    positions: OkxRawPosition[],
  ): Promise<Map<string, { tp: number | null; sl: number | null }>> {
    const out = new Map<string, { tp: number | null; sl: number | null }>();
    for (const symbol of new Set(positions.map((p) => p.symbol))) {
      const orders = await this.client.getPendingTpslOrders(symbol).catch(() => []);
      for (const o of orders.sort((a, b) => a.createTime - b.createTime)) {
        const key = tpslKeyOf(o.symbol, o.holdSide);
        const prev = out.get(key) ?? { tp: null, sl: null };
        // Newest non-null wins — sorted oldest-first, so later rows overwrite.
        out.set(key, {
          tp: o.takeProfitPrice ?? prev.tp,
          sl: o.stopLossPrice ?? prev.sl,
        });
      }
    }
    return out;
  }

  /**
   * A long takes profit above and stops out below the current price (a short is
   * mirrored). OKX rejects the inverse itself, but with an opaque error code —
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
   * Append a read-only `system` note to the position's journal timeline, keyed by
   * the same tradeKey the worker and web use. Best-effort: a logging failure must
   * never fail the trade action that produced it.
   */
  private async writeSystemLog(
    position: OkxRawPosition,
    content: string,
    snapshot: { entryPrice?: number; markPrice?: number },
  ): Promise<void> {
    if (!Number.isFinite(position.createTime) || position.createTime <= 0) return;
    await this.journalRepo
      .create({
        tradeKey: tradeKeyOf(position.symbol, position.holdSide, position.createTime),
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

  /**
   * Shape one OKX position for the dashboard. Unlike MEXC, OKX reports the mark
   * price, the break-even price and the unrealized PnL on the position row
   * itself, so all three are taken straight from the exchange; uPnL only falls
   * back to a price × size recompute when OKX omits the field.
   */
  private mapPosition(
    p: OkxRawPosition,
    tpsl: { tp: number | null; sl: number | null } | undefined,
  ): OkxPosition {
    const entryPrice = p.avgPx;
    const markPrice = p.markPx > 0 ? p.markPx : entryPrice;
    const marginUsd = p.imr;
    const dir = p.holdSide === 'long' ? 1 : -1;
    const unrealizedPnlUsd = p.upl != null ? p.upl : (markPrice - entryPrice) * p.size * dir;

    return {
      symbol: p.symbol,
      holdSide: p.holdSide,
      marginMode: p.marginMode,
      leverage: Number.isFinite(p.leverage) ? p.leverage : 0,
      size: p.size,
      entryPrice,
      markPrice,
      liquidationPrice: p.liqPx,
      breakEvenPrice: p.bePx,
      marginUsd,
      notionalUsd: p.size * markPrice,
      unrealizedPnlUsd,
      roePct: marginUsd > 0 ? (unrealizedPnlUsd / marginUsd) * 100 : 0,
      realizedPnlUsd: Number.isFinite(p.realizedPnl) ? p.realizedPnl : 0,
      takeProfitPrice: tpsl?.tp ?? null,
      stopLossPrice: tpsl?.sl ?? null,
      openedAt: p.createTime ? new Date(p.createTime).toISOString() : null,
      updatedAt: p.updateTime ? new Date(p.updateTime).toISOString() : null,
    };
  }
}

/** Decimal places of a step like 0.001 — used to de-noise the lot-size rounding. */
function scaleOfNumber(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}
