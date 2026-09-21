import { createHmac } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { createOrderRepository, createOkxOrderSyncStateRepository } from '@app/db';

/**
 * Read-only OKX order sync — the OKX twin of {@link BingxHistoryService}. Every
 * run reconciles the account's CURRENTLY-OPEN USDT-perpetual (SWAP) positions
 * into the generic `Order` table with `source='okx'`, so they show on /trades
 * alongside the manual trade book and the BingX-synced ones.
 *
 * Principles (identical to the BingX sync):
 *  - **No historical backfill.** The first sync only ANCHORS: it records the
 *    start time and the set of externalIds already open at that moment
 *    (`baseline`), then returns without inserting anything.
 *  - From then on, any newly-opened position (posId unseen and not in the
 *    baseline) is inserted as an open Order; a tracked open Order still live gets
 *    its size/entry/leverage reconciled.
 *  - When a tracked open Order's position is no longer live, it is flipped to
 *    `closed` — best-effort filling close price + realized PnL from
 *    `/account/positions-history`.
 *  - **Read-only**: only GET calls, never places or cancels anything.
 *
 * Signing (OKX V5): base64 HMAC-SHA256 over `timestamp + METHOD + requestPath + body`
 * where `requestPath` includes the query string; headers `OK-ACCESS-KEY/-SIGN/
 * -TIMESTAMP/-PASSPHRASE`; timestamp is ISO-8601 with ms (not epoch).
 */

const BASE_URL = process.env.OKX_API_BASE_URL ?? 'https://www.okx.com';
const INST_TYPE = 'SWAP';

const POSITIONS_PATH = '/api/v5/account/positions';
const POSITIONS_HISTORY_PATH = '/api/v5/account/positions-history';
const INSTRUMENTS_PATH = '/api/v5/public/instruments';

const BROKER = 'OKX';
const EXCHANGE = 'OKX';

type OkxEnvelope<T> = { code?: string; msg?: string; data: T };

/** Live open-position row (only the fields we read; every value is a string). */
type PositionRaw = {
  posId?: string;
  instId?: string; // "BTC-USDT-SWAP"
  posSide?: string; // "long" | "short" | "net"
  pos?: string; // size in CONTRACTS (signed in net mode)
  avgPx?: string;
  lever?: string;
  cTime?: string;
  uTime?: string;
};

/** Closed-position history row (subset). */
type ClosedRaw = {
  posId?: string;
  instId?: string;
  direction?: string; // "long" | "short" — valid in both position modes
  posSide?: string;
  closeAvgPx?: string;
  pnl?: string; // realized PnL excl. fees/funding
  realizedPnl?: string; // realized PnL incl. fees/funding
  uTime?: string; // close time (ms)
};

/** A live open position, normalised to the app's shape. */
type LivePosition = {
  externalId: string;
  symbol: string; // app format, e.g. "BTCUSDT"
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number; // base asset (contracts × ctVal)
  leverage: number | null;
  openedAtMs: number;
};

/** OKX instrument id ("BTC-USDT-SWAP") → app symbol ("BTCUSDT"). */
function fromOkxInstId(instId: string): string {
  const parts = instId.trim().toUpperCase().split('-');
  if (parts.length < 2) return instId.trim().toUpperCase();
  return `${parts[0]}${parts[1]}`;
}
/** App symbol ("BTCUSDT") → OKX instrument id ("BTC-USDT-SWAP") for USDT SWAPs. */
function toOkxInstId(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('-')) return s.endsWith(`-${INST_TYPE}`) ? s : `${s}-${INST_TYPE}`;
  const base = s.endsWith('USDT') ? s.slice(0, -4) : s;
  return `${base}-USDT-${INST_TYPE}`;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Prices equal within a tiny relative epsilon — avoids rewriting the row every
 *  sync over sub-cent float noise from the exchange's avg-price rounding. */
function priceEq(a: number | null | undefined, b: number): boolean {
  if (a == null || !Number.isFinite(a)) return false;
  return Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-6);
}
function qtyEq(a: number | null | undefined, b: number): boolean {
  if (a == null || !Number.isFinite(a)) return false;
  return Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-6);
}

function sideOf(direction?: string, signedPos = 0): 'long' | 'short' | null {
  const s = (direction ?? '').toLowerCase();
  if (s === 'long' || s === 'short') return s;
  // Net mode: no explicit side, infer from the sign of the contract size.
  if (signedPos > 0) return 'long';
  if (signedPos < 0) return 'short';
  return null;
}

@Injectable()
export class OkxHistoryService implements OnModuleInit {
  private readonly logger = new Logger(OkxHistoryService.name);
  private readonly orderRepo = createOrderRepository();
  private readonly stateRepo = createOkxOrderSyncStateRepository();
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 15_000 });

  private readonly apiKey = process.env.OKX_API_KEY ?? '';
  private readonly apiSecret = process.env.OKX_API_SECRET ?? '';
  private readonly passphrase = process.env.OKX_API_PASSPHRASE ?? '';
  private readonly simulated = process.env.OKX_SIMULATED === 'true';

  /** Contract-value (ctVal) per app symbol, to convert contracts → base asset. */
  private readonly ctValCache = new Map<string, number>();
  private syncing = false;

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.passphrase);
  }

  /** One catch-up sync a few seconds after boot so /trades has data on deploy. */
  onModuleInit(): void {
    if (!this.isConfigured()) return;
    setTimeout(() => {
      this.sync().catch((err) =>
        this.logger.warn(`Initial OKX order sync failed: ${(err as Error).message}`),
      );
    }, 14_000);
  }

  /**
   * Reconcile live OKX positions into the Order table. Returns how many orders
   * were opened / closed / updated this run. Overlap-guarded.
   */
  async sync(): Promise<{ opened: number; closed: number; updated: number }> {
    if (!this.isConfigured()) {
      this.logger.debug('OKX order sync skipped — credentials not configured');
      return { opened: 0, closed: 0, updated: 0 };
    }
    if (this.syncing) {
      this.logger.debug('OKX order sync already in progress — skipping');
      return { opened: 0, closed: 0, updated: 0 };
    }
    this.syncing = true;
    try {
      // A failed fetch must be distinguished from an empty one: a timeout returning
      // [] must NOT be read as "no positions open" (which would false-close every
      // tracked order, then re-open it next clean sync — a ~5min flicker off /trades).
      const res = await this.fetchLivePositions()
        .then((rows) => ({ ok: true, rows }))
        .catch((err) => {
          this.logger.warn(`OKX positions fetch failed: ${(err as Error).message}`);
          return { ok: false, rows: [] as LivePosition[] };
        });
      const live = res.rows;
      const liveIds = new Set(live.map((p) => p.externalId));

      // First run: anchor the start line + baseline, ingest nothing (no backfill).
      const state = await this.stateRepo.get();
      if (!state || state.historyStartAt == null) {
        if (!res.ok) {
          this.logger.warn('OKX sync: skipping first-run anchor — positions fetch failed');
          return { opened: 0, closed: 0, updated: 0 };
        }
        await this.stateRepo.anchor(new Date(), [...liveIds]);
        this.logger.log(`OKX sync anchored — ignoring ${liveIds.size} pre-existing position(s)`);
        return { opened: 0, closed: 0, updated: 0 };
      }
      const baseline = new Set(state.baseline);

      // 1. Insert newly-opened positions; reconcile still-open ones whose
      //    size/entry/leverage changed on the exchange.
      let opened = 0;
      let updated = 0;
      for (const pos of live) {
        const existing = await this.orderRepo.findByExternalId(pos.externalId);
        // Reconcile an already-tracked order even if the position is in the baseline:
        // the baseline only suppresses INGESTING pre-existing positions as brand-new
        // orders — once an order exists for this externalId (e.g. a manual order linked
        // to it), its size/entry/leverage must stay in sync when the trader adds volume.
        if (!existing && baseline.has(pos.externalId)) continue;
        if (existing) {
          if (existing.status === 'closed') {
            // Reported live NOW but our row is closed (e.g. same posId re-opened) —
            // reconcile back to open and clear the stale close fields.
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
          const patch: Record<string, number> = {};
          if (!priceEq(existing.entryPrice, pos.entryPrice)) patch.entryPrice = pos.entryPrice;
          if (!qtyEq(existing.quantity, pos.quantity)) patch.quantity = pos.quantity;
          if (pos.leverage != null && existing.leverage !== pos.leverage) patch.leverage = pos.leverage;
          if (Object.keys(patch).length > 0) {
            await this.orderRepo.update(existing.id, patch);
            updated++;
          }
          continue;
        }
        await this.orderRepo.create({
          source: 'okx',
          externalId: pos.externalId,
          symbol: pos.symbol,
          side: pos.side,
          entryPrice: pos.entryPrice,
          quantity: pos.quantity,
          leverage: pos.leverage ?? undefined,
          exchange: EXCHANGE,
          broker: BROKER,
          orderType: 'perpetual',
          status: 'open',
          openedAt: new Date(pos.openedAtMs),
        });
        opened++;
      }

      // 2. Reconcile closes: any tracked open okx Order no longer live closed.
      //    Skip entirely when the fetch failed — absence from liveIds is meaningless then.
      let closed = 0;
      if (res.ok) {
        const openOrders = (await this.orderRepo.listOpenBySource('okx')) as Array<{
          id: string;
          externalId: string | null;
          symbol: string;
          side: string;
          entryPrice: number;
          quantity: number | null;
          openedAt: Date;
        }>;
        for (const o of openOrders) {
          if (!o.externalId || liveIds.has(o.externalId)) continue;
          const close = await this.resolveClose(o).catch((err) => {
            this.logger.warn(`OKX close lookup failed for ${o.symbol}: ${(err as Error).message}`);
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
      }

      if (updated > 0) {
        this.logger.log(`OKX sync reconciled ${updated} open position(s) with new size/entry`);
      }
      return { opened, closed, updated };
    } finally {
      this.syncing = false;
    }
  }

  // ── Fetch: live positions ─────────────────────────────────────────────────

  private async fetchLivePositions(): Promise<LivePosition[]> {
    const rows = await this.signedGet<PositionRaw[] | null>(POSITIONS_PATH, { instType: INST_TYPE });
    const open = (rows ?? []).filter((p) => Math.abs(num(p.pos)) > 0);
    const out: LivePosition[] = [];
    for (const r of open) {
      const signedPos = num(r.pos);
      const side = sideOf(r.posSide, signedPos);
      const entry = num(r.avgPx);
      const posId = r.posId != null ? String(r.posId) : '';
      if (!r.instId || !posId || !side || !(entry > 0)) continue;
      const symbol = fromOkxInstId(r.instId);
      const ctVal = await this.contractSizeOf(symbol).catch(() => 1);
      const qty = Math.abs(signedPos) * (ctVal > 0 ? ctVal : 1);
      if (!(qty > 0)) continue;
      const lev = num(r.lever);
      const openMs = num(r.cTime);
      out.push({
        externalId: `okx-${posId}`,
        symbol,
        side,
        entryPrice: entry,
        quantity: qty,
        leverage: lev > 0 ? lev : null,
        openedAtMs: Number.isFinite(openMs) && openMs > 0 ? openMs : Date.now(),
      });
    }
    return out;
  }

  /** ctVal (contract value in base asset) for a symbol — public data, cached. */
  private async contractSizeOf(symbol: string): Promise<number> {
    const cached = this.ctValCache.get(symbol);
    if (cached != null) return cached;
    const instId = toOkxInstId(symbol);
    const rows = await this.signedGet<Array<{ instId?: string; ctVal?: string }> | null>(
      INSTRUMENTS_PATH,
      { instType: INST_TYPE, instId },
      { signed: false },
    );
    const row = (rows ?? []).find((r) => r.instId === instId) ?? rows?.[0];
    const ctVal = num(row?.ctVal);
    const value = ctVal > 0 ? ctVal : 1;
    this.ctValCache.set(symbol, value);
    return value;
  }

  // ── Reconcile: close price + realized PnL ─────────────────────────────────

  private async resolveClose(order: {
    externalId: string | null;
    symbol: string;
    side: string;
    entryPrice: number;
    quantity: number | null;
    openedAt: Date;
  }): Promise<{ closePrice: number | null; pnl: number | null; closedAt: Date } | null> {
    const instId = toOkxInstId(order.symbol);
    const posId = order.externalId?.replace('okx-', '');
    const rows = await this.signedGet<ClosedRaw[] | null>(POSITIONS_HISTORY_PATH, {
      instType: INST_TYPE,
      instId,
    });
    const list = rows ?? [];
    const match =
      (posId && list.find((r) => String(r.posId ?? '') === posId)) ||
      list.sort((a, b) => num(b.uTime) - num(a.uTime))[0];
    if (!match) return null;
    const closePrice = num(match.closeAvgPx);
    const reported = num(match.realizedPnl);
    const rawPnl = num(match.pnl);
    const closedAtMs = num(match.uTime);
    return {
      closePrice: Number.isFinite(closePrice) && closePrice > 0 ? closePrice : null,
      pnl: Number.isFinite(reported)
        ? reported
        : Number.isFinite(rawPnl)
          ? rawPnl
          : this.pnlFromPrices(order, closePrice),
      closedAt: Number.isFinite(closedAtMs) && closedAtMs > 0 ? new Date(closedAtMs) : new Date(),
    };
  }

  /** Absolute USDT PnL from entry/close (USDT-margined): (exit−entry)·qty, sign
   *  by side. Fallback only — OKX normally reports realized PnL directly. */
  private pnlFromPrices(
    order: { side: string; entryPrice: number; quantity: number | null },
    closePrice: number,
  ): number | null {
    const qty = order.quantity ?? 0;
    if (!(qty > 0) || !Number.isFinite(closePrice) || !(order.entryPrice > 0)) return null;
    const diff = order.side === 'short' ? order.entryPrice - closePrice : closePrice - order.entryPrice;
    return diff * qty;
  }

  // ── Signed / public GET ───────────────────────────────────────────────────

  private async signedGet<T>(
    path: string,
    query: Record<string, string | number> = {},
    opts: { signed?: boolean } = {},
  ): Promise<T> {
    const signed = opts.signed !== false;
    const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '');
    const queryString = entries.map(([k, v]) => `${k}=${v}`).join('&');
    const requestPath = queryString ? `${path}?${queryString}` : path;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.simulated) headers['x-simulated-trading'] = '1';
    if (signed) {
      // OKX wants an ISO-8601 timestamp WITH milliseconds, not epoch ms.
      const timestamp = new Date().toISOString();
      const prehash = `${timestamp}GET${requestPath}`;
      headers['OK-ACCESS-KEY'] = this.apiKey;
      headers['OK-ACCESS-SIGN'] = createHmac('sha256', this.apiSecret).update(prehash).digest('base64');
      headers['OK-ACCESS-TIMESTAMP'] = timestamp;
      headers['OK-ACCESS-PASSPHRASE'] = this.passphrase;
    }

    const res = await this.client.get<OkxEnvelope<T>>(requestPath, { headers });
    const body = res.data;
    if (body?.code != null && body.code !== '0') {
      throw new Error(`OKX ${path} error ${body.code}: ${body.msg ?? ''}`);
    }
    return body.data;
  }
}
