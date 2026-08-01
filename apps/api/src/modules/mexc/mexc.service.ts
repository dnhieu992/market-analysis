import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { summarizeMexcClosed, type MexcClosedSummary } from '@app/core';
import { createMexcTradeJournalRepository, createMexcTradeRepository } from '@app/db';

import {
  MexcTradeClient,
  buildExternalOid,
  type MexcRawPosition,
  type MexcStopOrder,
} from './mexc-trade.client';

/**
 * Capital originally put into the MEXC futures wallet, in USDT. The dashboard
 * shows account equity as a % of this, so it is the trader's "vốn gốc" — bump it
 * (or set `MEXC_INITIAL_CAPITAL_USD`) whenever more capital is deposited, or the
 * percentage silently becomes meaningless.
 */
const INITIAL_CAPITAL_USD = Number(process.env.MEXC_INITIAL_CAPITAL_USD ?? 100);

/** Canonical trade-session key — MUST match the worker/web (`symbol-holdSide-openedAt(ISO)`). */
function tradeKeyOf(symbol: string, holdSide: string, openedAtMs: number): string {
  return `${symbol}-${holdSide}-${new Date(openedAtMs).toISOString()}`;
}

/** Compact number formatting for the system journal lines. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export type MexcPosition = {
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
  /** When the position was opened (MEXC createTime). Anchors the trade-journal tradeKey. */
  openedAt: string | null;
  updatedAt: string | null;
};

export type MexcPositionsResult = {
  configured: boolean;
  positions: MexcPosition[];
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

export type MexcClosedTrade = {
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

export type MexcHistoryResult = {
  configured: boolean;
  trades: MexcClosedTrade[];
  summary: MexcClosedSummary;
  fetchedAt: string;
};

@Injectable()
export class MexcService {
  private readonly logger = new Logger(MexcService.name);
  private readonly client = new MexcTradeClient();
  private readonly tradeRepo = createMexcTradeRepository();
  private readonly journalRepo = createMexcTradeJournalRepository();

  async getOpenPositions(): Promise<MexcPositionsResult> {
    const fetchedAt = new Date().toISOString();

    if (!this.client.isConfigured()) {
      return {
        configured: false,
        positions: [],
        totalUnrealizedPnlUsd: 0,
        totalMarginUsd: 0,
        accountEquityUsd: null,
        initialCapitalUsd: INITIAL_CAPITAL_USD,
        equityChangePct: null,
        fetchedAt,
      };
    }

    let raw: MexcRawPosition[] = [];
    try {
      raw = await this.client.getAllPositions();
    } catch (err) {
      this.logger.warn(`Failed to fetch MEXC positions: ${(err as Error).message}`);
      throw err;
    }

    // Both are non-fatal — a failure here shouldn't blank the positions table.
    // MEXC's position rows carry no mark price, so fair prices come from one
    // public ticker call and the table falls back to the entry price without it.
    const [balance, fairPrices, tpsl] = await Promise.all([
      this.client.getAccountBalance().catch((err) => {
        this.logger.warn(`Failed to fetch MEXC account balance: ${(err as Error).message}`);
        return null;
      }),
      this.client.getFairPrices().catch((err) => {
        this.logger.warn(`Failed to fetch MEXC fair prices: ${(err as Error).message}`);
        return {} as Record<string, number>;
      }),
      this.readAllTpsl(raw).catch(() => new Map<number, { tp: number | null; sl: number | null }>()),
    ]);

    const positions = raw
      .map((p) => this.mapPosition(p, fairPrices[p.symbol], tpsl.get(p.positionId)))
      .sort((a, b) => Math.abs(b.notionalUsd) - Math.abs(a.notionalUsd));

    const totalUnrealizedPnlUsd = positions.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0);
    const totalMarginUsd = positions.reduce((sum, p) => sum + p.marginUsd, 0);

    return {
      configured: true,
      positions,
      totalUnrealizedPnlUsd,
      totalMarginUsd,
      accountEquityUsd: balance?.accountEquity ?? null,
      initialCapitalUsd: INITIAL_CAPITAL_USD,
      equityChangePct: this.equityChangePct(balance?.accountEquity),
      fetchedAt,
    };
  }

  /**
   * Closed-trade history + realized-PnL summary, read from the DB (the worker
   * mirrors MEXC's closed positions into `mexc_trades` on a cron). `configured`
   * reflects whether the same account credentials the worker syncs with are
   * present, so the page can explain an empty list.
   */
  async getClosedHistory(limit = 200, symbol?: string): Promise<MexcHistoryResult> {
    const fetchedAt = new Date().toISOString();
    const rows = await this.tradeRepo.findRecentClosed(limit, symbol);

    const trades: MexcClosedTrade[] = rows.map((r) => {
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

    const summary = summarizeMexcClosed(
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
   * Force-close a live position at market (a closing-side market order on
   * MEXC). Reads the position first so an already-flat side returns 409
   * (nothing to close) instead of a confusing exchange error. Throws 503 when
   * credentials are missing or the exchange call fails — never report success
   * while the position may be open.
   */
  async closePosition(
    symbol: string,
    holdSide: 'long' | 'short',
  ): Promise<{ closed: true; symbol: string; holdSide: 'long' | 'short' }> {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('MEXC credentials not configured — cannot close a position');
    }
    try {
      const position = await this.client.getPosition(symbol, holdSide);
      if (!position || position.holdVol <= 0) {
        throw new ConflictException('Vị thế đã đóng trên sàn — không còn gì để đóng.');
      }
      // MEXC requires a price even on a market order (it caps the fill), so the
      // live price goes with the close order.
      const price = await this.client.getTickerPrice(symbol);
      await this.client.closePosition(position, price);
      this.logger.log(`Force-closed MEXC position at market: ${symbol} ${holdSide} (size ${position.size})`);
      return { closed: true, symbol, holdSide };
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to force-close ${symbol} ${holdSide}: ${msg}`);
      throw new ServiceUnavailableException(`Không đóng được vị thế trên MEXC: ${msg}`);
    }
  }

  /**
   * Open a market position in cross margin from the Setup tab, or ADD volume to
   * the one already open on that coin+side. Derives the contract volume from the
   * requested margin × leverage ÷ live price ÷ contractSize (floored to the
   * contract's precision), then places a market order with no preset TP/SL.
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
      throw new ServiceUnavailableException('MEXC credentials not configured — cannot open a position');
    }
    if (!(marginUsd > 0)) throw new BadRequestException('Ký quỹ phải lớn hơn 0.');
    if (!(input.leverage >= 1)) throw new BadRequestException('Đòn bẩy phải ≥ 1.');

    try {
      const existing = await this.client.getPosition(symbol, holdSide);
      const existingSize = existing ? existing.size : 0;
      const isAdd = existingSize > 0;
      // Adding: keep the live position's own leverage — changing it under an open
      // position is not something MEXC applies to the existing margin, so sizing
      // the add-on with the configured value would misstate the notional.
      const existingLeverage = existing ? existing.leverage : NaN;
      const leverage =
        isAdd && Number.isFinite(existingLeverage) && existingLeverage >= 1 ? existingLeverage : input.leverage;

      const [price, spec] = await Promise.all([
        this.client.getTickerPrice(symbol),
        this.client.getContractSpec(symbol),
      ]);
      if (!spec.apiAllowed) {
        throw new BadRequestException(`MEXC không cho phép giao dịch ${symbol} qua API.`);
      }

      // notional = margin × leverage; base size = notional ÷ price; contracts =
      // base size ÷ contractSize, floored to `volScale` so MEXC accepts it.
      const baseSize = (marginUsd * leverage) / price;
      const rawVol = baseSize / spec.contractSize;
      const factor = 10 ** spec.volScale;
      const vol = Math.floor(rawVol * factor) / factor;
      if (vol < spec.minVol || vol <= 0) {
        throw new BadRequestException(
          `Ký quỹ quá nhỏ: ${vol} hợp đồng < tối thiểu ${spec.minVol} cho ${symbol}. Tăng ký quỹ hoặc đòn bẩy.`,
        );
      }
      const size = vol * spec.contractSize;

      // Leverage is only settable while flat — skip it entirely when adding.
      if (!isAdd) await this.client.setCrossLeverage(symbol, holdSide, leverage);
      const externalOid = buildExternalOid(symbol, holdSide);
      await this.client.openMarketPosition({ symbol, holdSide, vol, price, leverage, externalOid });

      const totalSize = existingSize + size;
      this.logger.log(
        `${isAdd ? 'Added volume to' : 'Opened'} MEXC market position: ${holdSide} ${symbol} ` +
          `size ${size} (${vol} contracts)${isAdd ? ` (was ${existingSize} → ${totalSize})` : ''} @~${price} ` +
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
          { entryPrice: existing.openAvgPrice, markPrice: price },
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
      throw new ServiceUnavailableException(`Không mở được vị thế trên MEXC: ${msg}`);
    }
  }

  /**
   * Set (or clear) the position-level take-profit / stop-loss on the exchange so
   * MEXC closes the position when a trigger is hit — this app being down must
   * never matter. `null` clears that side.
   *
   * MEXC allows exactly ONE position TP/SL order per position and rejects a
   * second `stoporder/place` with error 5005, so an update modifies the live
   * order in place instead of stacking a new one — see `replaceTpsl`.
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
      throw new ServiceUnavailableException('MEXC credentials not configured — cannot set TP/SL');
    }

    try {
      const position = await this.client.getPosition(symbol, holdSide);
      if (!position) {
        throw new ConflictException('Vị thế đã đóng trên sàn — không đặt được TP/SL.');
      }

      const spec = await this.client.getContractSpec(symbol);
      const markPrice = await this.client
        .getTicker(symbol)
        .then((t) => t.fairPrice || t.lastPrice)
        .catch(() => position.holdAvgPrice);
      const round = (n: number) => Number(n.toFixed(spec.priceScale));
      const tp = input.takeProfitPrice != null ? round(input.takeProfitPrice) : null;
      const sl = input.stopLossPrice != null ? round(input.stopLossPrice) : null;
      this.assertTpslDirection(holdSide, markPrice, tp, sl);

      // The levels being replaced, for the journal line only (best-effort).
      const existing = await this.readLiveTpslOrders(symbol, position.positionId);
      const prevTp = existing.find((o) => o.takeProfitPrice != null)?.takeProfitPrice ?? null;
      const prevSl = existing.find((o) => o.stopLossPrice != null)?.stopLossPrice ?? null;

      if (tp == null && sl == null) {
        // Clearing both sides: nothing to place, just drop what is live.
        await this.cancelTpslOrders(existing.map((o) => o.id));
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
        `Set MEXC TP/SL for ${holdSide} ${symbol}: TP ${tp ?? 'none'} (was ${prevTp ?? 'none'}), ` +
          `SL ${sl ?? 'none'} (was ${prevSl ?? 'none'})`,
      );
      await this.writeSystemLog(
        position,
        [
          `🎯 **Cập nhật TP/SL** ${holdSide === 'short' ? 'SHORT' : 'LONG'} ${symbol}`,
          `- Take Profit: ${tp != null ? fmtNum(tp) : 'đã xoá'}${prevTp != null ? ` (trước: ${fmtNum(prevTp)})` : ''}`,
          `- Stop Loss: ${sl != null ? fmtNum(sl) : 'đã xoá'}${prevSl != null ? ` (trước: ${fmtNum(prevSl)})` : ''}`,
          `- Giá hiện tại: ${fmtNum(markPrice)} · kích hoạt theo Fair Price, đóng toàn bộ vị thế`,
        ].join('\n'),
        { entryPrice: position.holdAvgPrice, markPrice },
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
      throw new ServiceUnavailableException(`Không đặt được TP/SL trên MEXC: ${msg}`);
    }
  }

  /**
   * Update the TP/SL of a position that ALREADY has a live stop order. MEXC
   * refuses a second `stoporder/place` for it (error 5005), so the live order is
   * modified in place — which also keeps the position protected throughout.
   *
   * Cancel-then-place is the fallback, used when the in-place path cannot work:
   * a side is being cleared (the change endpoints only set prices, they cannot
   * remove one), more than one order is somehow live, or the change call fails.
   * MEXC frees the "one TP/SL per position" slot asynchronously, so a place that
   * still hits 5005 right after the cancel is retried once.
   */
  private async replaceTpsl(
    position: MexcRawPosition,
    existing: MexcStopOrder[],
    tp: number | null,
    sl: number | null,
  ): Promise<void> {
    const current = existing[0];
    const clearsASide =
      current != null &&
      ((tp == null && current.takeProfitPrice != null) || (sl == null && current.stopLossPrice != null));

    if (current != null && existing.length === 1 && !clearsASide) {
      try {
        await this.client.changePositionTpsl({
          stopOrderId: current.id,
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

    // Fatal on purpose: if the old order survives, the place below hits 5005 and
    // the user must see why rather than get a generic failure.
    await this.client.cancelTpslOrders(existing.map((o) => o.id));

    const place = () =>
      this.client.placePositionTpsl({
        position,
        takeProfitPrice: tp ?? undefined,
        stopLossPrice: sl ?? undefined,
      });
    try {
      await place();
    } catch (err) {
      if (!/5005/.test((err as Error).message)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 800));
      await place();
    }
  }

  /** Live TP/SL orders attached to one position. `[]` when none or on failure. */
  private async readLiveTpslOrders(symbol: string, positionId: number) {
    try {
      const pending = await this.client.getPendingTpslOrders(symbol);
      return pending
        .filter((o) => o.positionId === positionId)
        .sort((a, b) => b.createTime - a.createTime);
    } catch {
      return [];
    }
  }

  /** Cancel superseded TP/SL orders; a failure only warns (see `setTpsl`). */
  private async cancelTpslOrders(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.client.cancelTpslOrders(ids);
      this.logger.log(`Cancelled ${ids.length} superseded MEXC TP/SL order(s)`);
    } catch (err) {
      this.logger.warn(
        `TP/SL cleanup failed: ${(err as Error).message}. A stale trigger may still be live on the exchange.`,
      );
    }
  }

  /**
   * Every position's live TP/SL, keyed by positionId — one call per distinct
   * symbol so the positions table can show the triggers MEXC holds (unlike
   * Bitget, they are not part of the position row).
   */
  private async readAllTpsl(
    positions: MexcRawPosition[],
  ): Promise<Map<number, { tp: number | null; sl: number | null }>> {
    const out = new Map<number, { tp: number | null; sl: number | null }>();
    for (const symbol of new Set(positions.map((p) => p.symbol))) {
      const orders = await this.client.getPendingTpslOrders(symbol).catch(() => []);
      for (const o of orders.sort((a, b) => a.createTime - b.createTime)) {
        const prev = out.get(o.positionId) ?? { tp: null, sl: null };
        // Newest non-null wins — sorted oldest-first, so later rows overwrite.
        out.set(o.positionId, {
          tp: o.takeProfitPrice ?? prev.tp,
          sl: o.stopLossPrice ?? prev.sl,
        });
      }
    }
    return out;
  }

  /**
   * A long takes profit above and stops out below the current price (a short is
   * mirrored). MEXC rejects the inverse itself, but with an opaque error code —
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
    position: MexcRawPosition,
    content: string,
    snapshot: { entryPrice?: number; markPrice?: number },
  ): Promise<void> {
    if (!Number.isFinite(position.createTime)) return;
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

  /** Equity vs the initial capital, in % — null when either number is unusable. */
  private equityChangePct(equity: number | undefined): number | null {
    if (equity == null || !Number.isFinite(equity)) return null;
    if (!Number.isFinite(INITIAL_CAPITAL_USD) || INITIAL_CAPITAL_USD <= 0) return null;
    return ((equity - INITIAL_CAPITAL_USD) / INITIAL_CAPITAL_USD) * 100;
  }

  /**
   * Shape one MEXC position for the dashboard. `fairPrice` comes from the public
   * ticker (MEXC positions carry no mark price); when it is missing the row
   * falls back to the entry price, which shows a flat 0 PnL rather than a wrong
   * one. uPnL is recomputed from price × size instead of trusting the exchange
   * field, so it stays consistent with the mark price actually displayed.
   */
  private mapPosition(
    p: MexcRawPosition,
    fairPrice: number | undefined,
    tpsl: { tp: number | null; sl: number | null } | undefined,
  ): MexcPosition {
    const entryPrice = p.holdAvgPrice || p.openAvgPrice;
    const markPrice = Number.isFinite(fairPrice) && (fairPrice ?? 0) > 0 ? (fairPrice as number) : entryPrice;
    const marginUsd = p.im;
    const dir = p.holdSide === 'long' ? 1 : -1;
    const unrealizedPnlUsd = (markPrice - entryPrice) * p.size * dir;

    return {
      symbol: p.symbol,
      holdSide: p.holdSide,
      marginMode: p.marginMode,
      leverage: Number.isFinite(p.leverage) ? p.leverage : 0,
      size: p.size,
      entryPrice,
      markPrice,
      liquidationPrice: p.liquidatePrice,
      // MEXC reports no break-even price — the column renders "—".
      breakEvenPrice: null,
      marginUsd,
      notionalUsd: p.size * markPrice,
      unrealizedPnlUsd,
      roePct: marginUsd > 0 ? (unrealizedPnlUsd / marginUsd) * 100 : 0,
      realizedPnlUsd: Number.isFinite(p.realised) ? p.realised : 0,
      takeProfitPrice: tpsl?.tp ?? null,
      stopLossPrice: tpsl?.sl ?? null,
      openedAt: p.createTime ? new Date(p.createTime).toISOString() : null,
      updatedAt: p.updateTime ? new Date(p.updateTime).toISOString() : null,
    };
  }
}
