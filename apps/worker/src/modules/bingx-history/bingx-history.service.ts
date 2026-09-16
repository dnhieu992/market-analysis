import { createHmac } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { createOrderRepository, createBingxSyncStateRepository } from '@app/db';

/**
 * Read-only BingX order sync. Every run reconciles the account's CURRENTLY-OPEN
 * positions — on both the **Perpetual Futures** (swap) and **Standard Futures**
 * (standard contract) products — into the generic `Order` table with
 * `source='bingx'`, so they appear on /trades alongside the manual trade book.
 *
 * Principles (per the product spec):
 *  - **No historical backfill.** The first sync only ANCHORS: it records the
 *    start time and the set of externalIds already open at that moment
 *    (`baseline`), then returns without inserting anything. Those pre-existing
 *    positions are "past" trades and are ignored for their whole life.
 *  - From then on, any newly-opened position (externalId unseen and not in the
 *    baseline) is inserted as an open Order.
 *  - When a tracked open Order's position is no longer live on the exchange, it
 *    is flipped to `closed` — best-effort filling close price + realized PnL from
 *    the exchange's history endpoints.
 *  - **Read-only**: this never places or cancels anything. Only GET calls.
 *
 * Signing (BingX): HMAC-SHA256 (hex) over the exact query string, appended as
 * `&signature=…`; the API key rides in the `X-BX-APIKEY` header; every request
 * carries a `timestamp` (ms) param.
 */

const BASE_URL = process.env.BINGX_API_BASE_URL ?? 'https://open-api.bingx.com';

const SWAP_POSITIONS_PATH = '/openApi/swap/v2/user/positions';
const SWAP_POSITION_HISTORY_PATH = '/openApi/swap/v1/trade/positionHistory';
const STD_POSITIONS_PATH = '/openApi/contract/v1/allPosition';
const STD_ALL_ORDERS_PATH = '/openApi/contract/v1/allOrders';

const BROKER_SWAP = 'BingX';
const BROKER_STD = 'BingX Standard';
const EXCHANGE = 'BingX';

type BingxEnvelope<T> = { code?: number | string; msg?: string; data: T };

/** Perpetual open-position row (only the fields we read; parsed defensively). */
type SwapPositionRaw = {
  positionId?: string | number;
  symbol?: string; // "BTC-USDT"
  positionSide?: string; // "LONG" | "SHORT"
  positionAmt?: string | number;
  availableAmt?: string | number;
  avgPrice?: string | number;
  leverage?: string | number;
  createTime?: string | number;
  updateTime?: string | number;
};

/** Standard-contract open-position row. */
type StdPositionRaw = {
  symbol?: string; // "BTC-USDT"
  positionSide?: string; // "LONG" | "SHORT"
  entryPrice?: string | number;
  positionAmt?: string | number;
  leverage?: string | number;
  time?: string | number; // position open time (ms)
};

/** A live open position, normalised to the app's shape. */
type LivePosition = {
  externalId: string;
  broker: string;
  orderType: 'perpetual' | 'standard';
  symbol: string; // app format, e.g. "BTCUSDT"
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number | null;
  openedAtMs: number;
};

/** BingX symbol ("BTC-USDT") → app symbol ("BTCUSDT"). */
function toAppSymbol(symbol: string): string {
  return symbol.replace('-', '').toUpperCase();
}
/** App symbol ("BTCUSDT") → BingX symbol ("BTC-USDT") for USDT-margined pairs. */
function toBingxSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('-')) return s;
  return s.endsWith('USDT') ? `${s.slice(0, -4)}-USDT` : s;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Prices are equal within a tiny relative epsilon — avoids rewriting the row
 *  every sync over sub-cent float noise from the exchange's avg-price rounding. */
function priceEq(a: number | null | undefined, b: number): boolean {
  if (a == null || !Number.isFinite(a)) return false;
  return Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-6);
}

/** Quantities equal within a tiny relative epsilon (contract sizes vary widely). */
function qtyEq(a: number | null | undefined, b: number): boolean {
  if (a == null || !Number.isFinite(a)) return false;
  return Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-6);
}

function sideOf(positionSide?: string): 'long' | 'short' | null {
  const s = (positionSide ?? '').toUpperCase();
  if (s === 'LONG') return 'long';
  if (s === 'SHORT') return 'short';
  return null;
}

@Injectable()
export class BingxHistoryService implements OnModuleInit {
  private readonly logger = new Logger(BingxHistoryService.name);
  private readonly orderRepo = createOrderRepository();
  private readonly stateRepo = createBingxSyncStateRepository();
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 10_000 });

  private readonly apiKey = process.env.BINGX_API_KEY ?? '';
  private readonly apiSecret = process.env.BINGX_API_SECRET ?? '';

  private syncing = false;

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  /** One catch-up sync a few seconds after boot so /trades has data on deploy. */
  onModuleInit(): void {
    if (!this.isConfigured()) return;
    setTimeout(() => {
      this.sync().catch((err) =>
        this.logger.warn(`Initial BingX order sync failed: ${(err as Error).message}`),
      );
    }, 12_000);
  }

  /**
   * Reconcile live BingX positions (swap + standard) into the Order table.
   * Returns how many orders were opened / closed / updated this run.
   * Overlap-guarded.
   */
  async sync(): Promise<{ opened: number; closed: number; updated: number }> {
    if (!this.isConfigured()) {
      this.logger.debug('BingX order sync skipped — credentials not configured');
      return { opened: 0, closed: 0, updated: 0 };
    }
    if (this.syncing) {
      this.logger.debug('BingX order sync already in progress — skipping');
      return { opened: 0, closed: 0, updated: 0 };
    }
    this.syncing = true;
    try {
      // Fetch live positions from both products. Each is independent and
      // non-fatal: a Standard-futures outage must not stall the swap sync.
      const [swap, std] = await Promise.all([
        this.fetchSwapPositions().catch((err) => {
          this.logger.warn(`BingX swap positions fetch failed: ${(err as Error).message}`);
          return [] as LivePosition[];
        }),
        this.fetchStandardPositions().catch((err) => {
          this.logger.warn(`BingX standard positions fetch failed: ${(err as Error).message}`);
          return [] as LivePosition[];
        }),
      ]);
      const live = [...swap, ...std];
      const liveIds = new Set(live.map((p) => p.externalId));

      // First run: anchor the start line + baseline, ingest nothing (no backfill).
      const state = await this.stateRepo.get();
      if (!state || state.historyStartAt == null) {
        await this.stateRepo.anchor(new Date(), [...liveIds]);
        this.logger.log(`BingX sync anchored — ignoring ${liveIds.size} pre-existing position(s)`);
        return { opened: 0, closed: 0, updated: 0 };
      }
      const baseline = new Set(state.baseline);

      // 1. Insert newly-opened positions (unseen, and not part of the baseline);
      //    reconcile still-open ones whose size/entry changed on the exchange.
      let opened = 0;
      let updated = 0;
      for (const pos of live) {
        if (baseline.has(pos.externalId)) continue;
        const existing = await this.orderRepo.findByExternalId(pos.externalId);
        if (existing) {
          // The externalId already has an Order. A live position can carry a
          // CLOSED order — e.g. the one-off backfill mis-ingested a still-open
          // position from close history, or the same position id was genuinely
          // re-opened. Since the exchange reports it live NOW, reconcile the row
          // back to open and clear the stale close fields so it returns to /trades.
          if (existing.status === 'closed') {
            await this.orderRepo.update(existing.id, {
              status: 'open',
              closePrice: null,
              pnl: null,
              closedAt: null,
              entryPrice: pos.entryPrice,
              quantity: pos.quantity,
              leverage: pos.leverage ?? undefined,
              openedAt: new Date(pos.openedAtMs),
            });
            opened++;
            continue;
          }
          // Still open: the user may have added or trimmed volume, which changes
          // the exchange's avg entry price and quantity. Mirror those onto the
          // stored Order so /trades shows the live size, not the stale one.
          const patch: Record<string, number> = {};
          if (!priceEq(existing.entryPrice, pos.entryPrice)) patch.entryPrice = pos.entryPrice;
          if (!qtyEq(existing.quantity, pos.quantity)) patch.quantity = pos.quantity;
          if (pos.leverage != null && existing.leverage !== pos.leverage) {
            patch.leverage = pos.leverage;
          }
          if (Object.keys(patch).length > 0) {
            await this.orderRepo.update(existing.id, patch);
            updated++;
          }
          continue;
        }
        await this.orderRepo.create({
          source: 'bingx',
          externalId: pos.externalId,
          symbol: pos.symbol,
          side: pos.side,
          entryPrice: pos.entryPrice,
          quantity: pos.quantity,
          leverage: pos.leverage ?? undefined,
          exchange: EXCHANGE,
          broker: pos.broker,
          orderType: pos.orderType,
          status: 'open',
          openedAt: new Date(pos.openedAtMs),
        });
        opened++;
      }

      // 2. Reconcile closes: any tracked open bingx Order no longer live closed.
      let closed = 0;
      const openOrders = (await this.orderRepo.listOpenBySource('bingx')) as Array<{
        id: string;
        externalId: string | null;
        symbol: string;
        side: string;
        entryPrice: number;
        quantity: number | null;
        broker: string | null;
        openedAt: Date;
      }>;
      for (const o of openOrders) {
        if (!o.externalId || liveIds.has(o.externalId)) continue;
        const close = await this.resolveClose(o).catch((err) => {
          this.logger.warn(`BingX close lookup failed for ${o.symbol}: ${(err as Error).message}`);
          return null;
        });
        await this.orderRepo.update(o.id, {
          status: 'closed',
          closePrice: close?.closePrice ?? undefined,
          pnl: close?.pnl ?? undefined,
          closedAt: close?.closedAt ?? new Date(),
        });
        closed++;
      }

      if (updated > 0) {
        this.logger.log(`BingX sync reconciled ${updated} open position(s) with new size/entry`);
      }
      return { opened, closed, updated };
    } finally {
      this.syncing = false;
    }
  }

  // ── Backfill (one-off): today's closed + still-open into /trades ──────────

  /**
   * Re-anchor the sync start line with an EMPTY baseline. The first-run anchor
   * records the currently-open externalIds to ignore them forever; this instead
   * makes the next `sync()` ingest EVERY currently-open position (and reconcile
   * it to close later). Used by the backfill runner so still-open positions show.
   */
  async resetAnchor(startAt: Date): Promise<void> {
    await this.stateRepo.anchor(startAt, []);
  }

  /** Candidate BingX symbols to probe for closed history — the history endpoints
   *  require an explicit symbol. Union of currently-open symbols, TRACKED_SYMBOLS
   *  and a majors fallback. */
  private backfillSymbols(open: LivePosition[]): string[] {
    const set = new Set<string>();
    for (const p of open) set.add(toBingxSymbol(p.symbol));
    for (const t of (process.env.TRACKED_SYMBOLS ?? '').split(',')) {
      if (t.trim()) set.add(toBingxSymbol(t.trim()));
    }
    for (const d of ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT']) set.add(d);
    return [...set];
  }

  /**
   * One-off backfill of positions CLOSED since `startMs` (both products) into the
   * Order table. The ongoing `sync()` only reads LIVE positions, so closed trades
   * are never ingested by it — this fills that gap for a bounded window.
   * Insert-only, deduped by externalId; returns how many closed orders inserted.
   */
  async backfillClosedSince(startMs: number): Promise<number> {
    if (!this.isConfigured()) return 0;
    const [swap, std] = await Promise.all([
      this.fetchSwapPositions().catch(() => [] as LivePosition[]),
      this.fetchStandardPositions().catch(() => [] as LivePosition[]),
    ]);
    const symbols = this.backfillSymbols([...swap, ...std]);
    let inserted = 0;
    for (const sym of symbols) {
      inserted += await this.backfillSwapClosed(sym, startMs).catch((err) => {
        this.logger.warn(`BingX swap backfill ${sym} failed: ${(err as Error).message}`);
        return 0;
      });
      inserted += await this.backfillStdClosed(sym, startMs).catch((err) => {
        this.logger.warn(`BingX std backfill ${sym} failed: ${(err as Error).message}`);
        return 0;
      });
    }
    return inserted;
  }

  /** Insert one already-closed order, deduped by externalId. Returns 1 if inserted. */
  private async insertClosed(o: {
    externalId: string;
    broker: string;
    orderType: 'perpetual' | 'standard';
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    quantity: number;
    leverage: number | null;
    openedAtMs: number;
    closePrice: number | null;
    pnl: number | null;
    closedAtMs: number;
  }): Promise<number> {
    if (await this.orderRepo.findByExternalId(o.externalId)) return 0;
    await this.orderRepo.create({
      source: 'bingx',
      externalId: o.externalId,
      symbol: o.symbol,
      side: o.side,
      entryPrice: o.entryPrice,
      quantity: o.quantity,
      leverage: o.leverage ?? undefined,
      exchange: EXCHANGE,
      broker: o.broker,
      orderType: o.orderType,
      status: 'closed',
      openedAt: new Date(o.openedAtMs),
      closePrice: o.closePrice ?? undefined,
      pnl: o.pnl ?? undefined,
      closedAt: new Date(o.closedAtMs),
    });
    return 1;
  }

  private async backfillSwapClosed(bingxSymbol: string, startMs: number): Promise<number> {
    const data = await this.signedGet<
      Record<string, unknown>[] | { positionHistory?: Record<string, unknown>[] }
    >(SWAP_POSITION_HISTORY_PATH, { symbol: bingxSymbol, startTs: startMs, endTs: Date.now() });
    const list = Array.isArray(data) ? data : (data.positionHistory ?? []);
    let n = 0;
    for (const r of list) {
      const closedAtMs = num(r.closeTime ?? r.updateTime);
      if (!(closedAtMs >= startMs)) continue;
      const side = sideOf(String(r.positionSide ?? ''));
      const entry = num(r.avgPrice ?? r.openAvgPrice ?? r.avgOpenPrice);
      const qty = Math.abs(num(r.positionAmt ?? r.closePositionAmt ?? r.volume));
      if (!side || !(entry > 0) || !(qty > 0)) continue;
      const positionId =
        r.positionId != null ? String(r.positionId) : `${bingxSymbol}-${side}-${closedAtMs}`;
      const closePrice = num(r.avgClosePrice ?? r.closeAvgPrice ?? r.closePrice);
      const reported = num(r.netProfit ?? r.realisedProfit ?? r.realizedProfit);
      const lev = num(r.leverage);
      n += await this.insertClosed({
        externalId: `bingx-swap-${positionId}`,
        broker: BROKER_SWAP,
        orderType: 'perpetual',
        symbol: toAppSymbol(bingxSymbol),
        side,
        entryPrice: entry,
        quantity: qty,
        leverage: lev > 0 ? lev : null,
        openedAtMs: num(r.openTime ?? r.createTime) || closedAtMs,
        closePrice: Number.isFinite(closePrice) ? closePrice : null,
        pnl: Number.isFinite(reported)
          ? reported
          : this.pnlFromPrices({ side, entryPrice: entry, quantity: qty }, closePrice),
        closedAtMs,
      });
    }
    return n;
  }

  private async backfillStdClosed(bingxSymbol: string, startMs: number): Promise<number> {
    const rows = await this.signedGet<
      Record<string, unknown>[] | { orders?: Record<string, unknown>[] }
    >(STD_ALL_ORDERS_PATH, { symbol: bingxSymbol, startTime: startMs, endTime: Date.now() });
    const list = Array.isArray(rows) ? rows : (rows.orders ?? []);
    let n = 0;
    for (const r of list) {
      if (String(r.status ?? '').toUpperCase() !== 'CLOSED') continue;
      const closedAtMs = num(r.updateTime);
      if (!(closedAtMs >= startMs)) continue;
      const side = sideOf(String(r.positionSide ?? ''));
      const entry = num(r.avgPrice);
      const qty = Math.abs(num(r.executedQty));
      const closePrice = num(r.closePrice);
      if (!side || !(entry > 0) || !(qty > 0)) continue;
      const openedAtMs = num(r.time) || closedAtMs;
      const lev = num(r.leverage);
      // Standard rows omit `symbol` — key on the queried symbol + side + times so a
      // re-open of the same pair the same day stays a distinct order.
      n += await this.insertClosed({
        externalId: `bingx-std-${bingxSymbol}-${side}-${openedAtMs}-${closedAtMs}`,
        broker: BROKER_STD,
        orderType: 'standard',
        symbol: toAppSymbol(bingxSymbol),
        side,
        entryPrice: entry,
        quantity: qty,
        leverage: lev > 0 ? lev : null,
        openedAtMs,
        closePrice: Number.isFinite(closePrice) ? closePrice : null,
        pnl: this.pnlFromPrices({ side, entryPrice: entry, quantity: qty }, closePrice),
        closedAtMs,
      });
    }
    return n;
  }

  // ── Fetch: live positions ───────────────────────────────────────────────

  private async fetchSwapPositions(): Promise<LivePosition[]> {
    const data = await this.signedGet<SwapPositionRaw[] | null>(SWAP_POSITIONS_PATH);
    const rows = Array.isArray(data) ? data : [];
    const out: LivePosition[] = [];
    for (const r of rows) {
      const side = sideOf(r.positionSide);
      const qty = Math.abs(num(r.positionAmt));
      const entry = num(r.avgPrice);
      if (!r.symbol || !side || !(qty > 0) || !(entry > 0)) continue;
      const positionId = r.positionId != null ? String(r.positionId) : `${r.symbol}-${side}`;
      const lev = num(r.leverage);
      const openMs = num(r.createTime ?? r.updateTime);
      out.push({
        externalId: `bingx-swap-${positionId}`,
        broker: BROKER_SWAP,
        orderType: 'perpetual',
        symbol: toAppSymbol(r.symbol),
        side,
        entryPrice: entry,
        quantity: qty,
        leverage: lev > 0 ? lev : null,
        openedAtMs: Number.isFinite(openMs) && openMs > 0 ? openMs : Date.now(),
      });
    }
    return out;
  }

  private async fetchStandardPositions(): Promise<LivePosition[]> {
    const data = await this.signedGet<StdPositionRaw[] | null>(STD_POSITIONS_PATH);
    const rows = Array.isArray(data) ? data : [];
    const out: LivePosition[] = [];
    for (const r of rows) {
      const side = sideOf(r.positionSide);
      const qty = Math.abs(num(r.positionAmt));
      const entry = num(r.entryPrice);
      if (!r.symbol || !side || !(qty > 0) || !(entry > 0)) continue;
      const openMs = num(r.time);
      const openStamp = Number.isFinite(openMs) && openMs > 0 ? openMs : Date.now();
      const lev = num(r.leverage);
      out.push({
        // Standard positions carry no id — key on symbol+side+openTime so a
        // later re-open of the same pair is a distinct order, not a collision.
        externalId: `bingx-std-${r.symbol}-${side}-${openStamp}`,
        broker: BROKER_STD,
        orderType: 'standard',
        symbol: toAppSymbol(r.symbol),
        side,
        entryPrice: entry,
        quantity: qty,
        leverage: lev > 0 ? lev : null,
        openedAtMs: openStamp,
      });
    }
    return out;
  }

  // ── Reconcile: close price + realized PnL ───────────────────────────────

  private async resolveClose(order: {
    externalId: string | null;
    symbol: string;
    side: string;
    entryPrice: number;
    quantity: number | null;
    broker: string | null;
    openedAt: Date;
  }): Promise<{ closePrice: number | null; pnl: number | null; closedAt: Date } | null> {
    const bingxSymbol = toBingxSymbol(order.symbol);
    const startTime = order.openedAt.getTime();

    if (order.broker === BROKER_STD) {
      // Standard futures: match the CLOSED order for this symbol; realized PnL
      // isn't reported, so derive it from close vs entry price.
      const rows = await this.signedGet<Record<string, unknown>[] | { orders?: Record<string, unknown>[] }>(
        STD_ALL_ORDERS_PATH,
        { symbol: bingxSymbol, startTime },
      );
      const list = Array.isArray(rows) ? rows : (rows.orders ?? []);
      const match = list
        .filter((r) => String(r.status ?? '').toUpperCase() === 'CLOSED')
        .sort((a, b) => num(b.updateTime) - num(a.updateTime))[0];
      if (!match) return null;
      const closePrice = num(match.closePrice ?? match.avgPrice);
      const closedAtMs = num(match.updateTime);
      const pnl = this.pnlFromPrices(order, closePrice);
      return {
        closePrice: Number.isFinite(closePrice) ? closePrice : null,
        pnl,
        closedAt: Number.isFinite(closedAtMs) && closedAtMs > 0 ? new Date(closedAtMs) : new Date(),
      };
    }

    // Perpetual: positionHistory reports avgClosePrice + realized/net profit.
    const positionId = order.externalId?.replace('bingx-swap-', '');
    // positionHistory requires symbol + startTs + endTs (NOT startTime); missing
    // any of them returns error 109400 and no close price / PnL is ever recorded.
    const data = await this.signedGet<
      Record<string, unknown>[] | { positionHistory?: Record<string, unknown>[] }
    >(SWAP_POSITION_HISTORY_PATH, { symbol: bingxSymbol, startTs: startTime, endTs: Date.now() });
    const list = Array.isArray(data) ? data : (data.positionHistory ?? []);
    const match =
      (positionId && list.find((r) => String(r.positionId ?? '') === positionId)) ||
      list.sort((a, b) => num(b.closeTime ?? b.updateTime) - num(a.closeTime ?? a.updateTime))[0];
    if (!match) return null;
    const closePrice = num(match.avgClosePrice ?? match.closeAvgPrice ?? match.closePrice);
    const reported = num(match.netProfit ?? match.realisedProfit ?? match.realizedProfit);
    const closedAtMs = num(match.closeTime ?? match.updateTime);
    return {
      closePrice: Number.isFinite(closePrice) ? closePrice : null,
      pnl: Number.isFinite(reported) ? reported : this.pnlFromPrices(order, closePrice),
      closedAt: Number.isFinite(closedAtMs) && closedAtMs > 0 ? new Date(closedAtMs) : new Date(),
    };
  }

  /** Absolute USDT PnL from entry/close (USDT-margined): (exit−entry)·qty, sign
   *  by side. Leverage doesn't change absolute PnL, only ROE. */
  private pnlFromPrices(
    order: { side: string; entryPrice: number; quantity: number | null },
    closePrice: number,
  ): number | null {
    const qty = order.quantity ?? 0;
    if (!(qty > 0) || !Number.isFinite(closePrice) || !(order.entryPrice > 0)) return null;
    const diff = order.side === 'short' ? order.entryPrice - closePrice : closePrice - order.entryPrice;
    return diff * qty;
  }

  // ── Signed GET ──────────────────────────────────────────────────────────

  private async signedGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const withTs: Record<string, string | number> = { ...params, timestamp: Date.now() };
    const queryString = Object.keys(withTs)
      .map((k) => `${k}=${withTs[k]}`)
      .join('&');
    const signature = createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
    const url = `${path}?${queryString}&signature=${signature}`;

    const res = await this.client.get<BingxEnvelope<T>>(url, {
      headers: { 'X-BX-APIKEY': this.apiKey },
    });
    const body = res.data;
    // BingX returns code 0 on success; some endpoints omit it entirely.
    if (body.code !== undefined && String(body.code) !== '0') {
      throw new Error(`BingX ${path} error ${body.code}: ${body.msg ?? ''}`);
    }
    return body.data;
  }
}
