import { createHmac } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

/**
 * OKX V5 trading client for the /trades OKX short AI chat — USDT-margined perpetual
 * SWAPs, cross margin. Reads the account (positions, balance, pending orders, TP algos)
 * and, ONLY when the user confirms an AI card, places / closes / cancels orders.
 *
 * Credentials: OKX_TRADE_API_KEY / _SECRET / _PASSPHRASE when set (a key WITH the
 * Trade permission), else the OKX_API_* key the worker's read-only /trades sync uses —
 * which then needs the Trade permission enabled for orders to go through.
 *
 * Works in both OKX position modes: long/short mode (posSide=short) and net mode
 * (sell to open, reduce-only buy to close).
 */

const BASE_URL = process.env.OKX_API_BASE_URL ?? 'https://www.okx.com';
const INST_TYPE = 'SWAP';
const TD_MODE = 'cross';

type Envelope<T> = { code?: string; msg?: string; data: T };

type PositionRaw = {
  posId?: string;
  instId?: string;
  posSide?: string;
  pos?: string;
  avgPx?: string;
  markPx?: string;
  lever?: string;
  margin?: string;
  imr?: string;
  upl?: string;
  uplRatio?: string;
  liqPx?: string;
  mgnMode?: string;
  notionalUsd?: string;
  cTime?: string;
  uTime?: string;
};

type AlgoRaw = {
  algoId?: string;
  instId?: string;
  posSide?: string;
  side?: string;
  tpTriggerPx?: string;
  slTriggerPx?: string;
  closeFraction?: string;
  reduceOnly?: string;
  sz?: string;
};

type PendingRaw = {
  ordId?: string;
  instId?: string;
  side?: string;
  posSide?: string;
  ordType?: string;
  px?: string;
  sz?: string;
  lever?: string;
  reduceOnly?: string;
  cTime?: string;
};

type InstrumentRaw = { instId?: string; ctVal?: string; lotSz?: string; minSz?: string; tickSz?: string; state?: string; lever?: string };

export type OkxInstrument = { instId: string; ctVal: number; lotSz: number; minSz: number; tickSz: number; maxLever: number | null };

export type OkxPosition = {
  symbol: string;
  instId: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  leverage: number;
  /** Size in BASE coin (contracts × ctVal). */
  size: number;
  contracts: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  marginUsd: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  roePct: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  openedAt: string | null;
  posId: string | null;
};

export type OkxPendingOrder = {
  orderId: string;
  symbol: string;
  holdSide: 'long' | 'short' | null;
  side: string;
  orderType: string;
  price: number;
  size: number;
  contracts: number;
  leverage: number | null;
  marginUsd: number | null;
  reduceOnly: boolean;
  createdAt: string | null;
};

export type OkxAccountSnapshot = {
  configured: boolean;
  positions: OkxPosition[];
  equityUsd: number | null;
  availableUsd: number | null;
  totalMarginUsd: number;
  totalUnrealizedPnlUsd: number;
  posMode: 'long_short_mode' | 'net_mode' | null;
  /** False when the API key has no Trade permission (orders would be rejected). Null = unknown. */
  canTrade: boolean | null;
  fetchedAt: string;
};

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : NaN;
};
const orNull = (v: unknown): number | null => {
  const x = n(v);
  return Number.isFinite(x) && x !== 0 ? x : null;
};

/** "BTC-USDT-SWAP" → "BTCUSDT". */
export function fromInstId(instId: string): string {
  const [base, quote] = instId.trim().toUpperCase().split('-');
  return quote ? `${base}${quote}` : instId.toUpperCase();
}

/** "btc" / "BTCUSDT" → "BTC-USDT-SWAP". */
export function toInstId(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('-')) return s.endsWith(`-${INST_TYPE}`) ? s : `${s}-${INST_TYPE}`;
  const base = s.endsWith('USDT') ? s.slice(0, -4) : s;
  return `${base}-USDT-${INST_TYPE}`;
}

/** Decimal places of a step like "0.01" / "1" / "1e-5". */
function decimalsOf(step: number): number {
  if (!(step > 0)) return 0;
  const s = step.toString();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  return s.includes('.') ? s.split('.')[1]!.length : 0;
}

/** Floor `value` to a multiple of `step`, as the string OKX expects. */
export function floorToStep(value: number, step: number): string {
  if (!(step > 0)) return String(value);
  const d = decimalsOf(step);
  const units = Math.floor(value / step + 1e-9);
  return (units * step).toFixed(d);
}

/** Contracts for a margin × leverage at a price, floored to the lot size. */
export function contractsFromMargin(marginUsd: number, leverage: number, price: number, inst: Pick<OkxInstrument, 'ctVal' | 'lotSz' | 'minSz'>): string {
  const raw = (marginUsd * leverage) / (price * inst.ctVal);
  const sz = floorToStep(raw, inst.lotSz);
  if (!(Number(sz) >= inst.minSz)) {
    const minMargin = (inst.minSz * inst.ctVal * price) / leverage;
    throw new BadRequestException(
      `Ký quỹ quá nhỏ: tối thiểu ${inst.minSz} hợp đồng (~$${minMargin.toFixed(2)} ký quỹ ở ${leverage}×).`,
    );
  }
  return sz;
}

@Injectable()
export class OkxService {
  private readonly logger = new Logger(OkxService.name);
  private readonly http: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 15_000 });
  private readonly apiKey = process.env.OKX_TRADE_API_KEY || process.env.OKX_API_KEY || '';
  private readonly apiSecret = process.env.OKX_TRADE_API_SECRET || process.env.OKX_API_SECRET || '';
  private readonly passphrase = process.env.OKX_TRADE_API_PASSPHRASE || process.env.OKX_API_PASSPHRASE || '';
  private readonly simulated = process.env.OKX_SIMULATED === 'true';
  private readonly instruments = new Map<string, OkxInstrument>();
  private configCache: { posMode: 'long_short_mode' | 'net_mode'; canTrade: boolean | null; at: number } | null = null;

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.passphrase);
  }

  // ── reads ────────────────────────────────────────────────────────────────

  /** Position mode + key permission from /account/config (cached 10 min). */
  async getConfig(): Promise<{ posMode: 'long_short_mode' | 'net_mode'; canTrade: boolean | null }> {
    if (this.configCache && Date.now() - this.configCache.at < 10 * 60_000) return this.configCache;
    const rows = await this.request<Array<{ posMode?: string; perm?: string }>>('GET', '/api/v5/account/config');
    const perm = rows?.[0]?.perm;
    this.configCache = {
      posMode: rows?.[0]?.posMode === 'net_mode' ? 'net_mode' : 'long_short_mode',
      canTrade: perm ? perm.split(',').map((x) => x.trim()).includes('trade') : null,
      at: Date.now(),
    };
    return this.configCache;
  }

  async getPosMode(): Promise<'long_short_mode' | 'net_mode'> {
    return (await this.getConfig()).posMode;
  }

  /** Public instrument spec (cached). Throws when the coin has no USDT SWAP on OKX. */
  async getInstrument(symbol: string): Promise<OkxInstrument> {
    const instId = toInstId(symbol);
    const cached = this.instruments.get(instId);
    if (cached) return cached;
    const rows = await this.request<InstrumentRaw[]>('GET', '/api/v5/public/instruments', { instType: INST_TYPE, instId }, undefined, false).catch(
      () => [] as InstrumentRaw[],
    );
    const r = rows?.find((x) => x.instId === instId);
    if (!r || (r.state && r.state !== 'live')) throw new BadRequestException(`${fromInstId(instId)} không có hợp đồng SWAP đang giao dịch trên OKX.`);
    const inst: OkxInstrument = {
      instId,
      ctVal: n(r.ctVal) > 0 ? n(r.ctVal) : 1,
      lotSz: n(r.lotSz) > 0 ? n(r.lotSz) : 1,
      minSz: n(r.minSz) > 0 ? n(r.minSz) : 1,
      tickSz: n(r.tickSz) > 0 ? n(r.tickSz) : 0,
      maxLever: orNull(r.lever),
    };
    this.instruments.set(instId, inst);
    return inst;
  }

  async getTickerPrice(symbol: string): Promise<number> {
    const rows = await this.request<Array<{ last?: string }>>('GET', '/api/v5/market/ticker', { instId: toInstId(symbol) }, undefined, false);
    const px = n(rows?.[0]?.last);
    if (!(px > 0)) throw new Error(`Không lấy được giá ${symbol} trên OKX.`);
    return px;
  }

  async getAccount(): Promise<OkxAccountSnapshot> {
    const fetchedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return { configured: false, positions: [], equityUsd: null, availableUsd: null, totalMarginUsd: 0, totalUnrealizedPnlUsd: 0, posMode: null, canTrade: null, fetchedAt };
    }
    const [positions, balance, config] = await Promise.all([
      this.getPositions(),
      this.request<Array<{ totalEq?: string; details?: Array<{ ccy?: string; eq?: string; availEq?: string; availBal?: string }> }>>(
        'GET',
        '/api/v5/account/balance',
        { ccy: 'USDT' },
      ).catch((e: Error) => {
        this.logger.warn(`OKX balance failed: ${e.message}`);
        return null;
      }),
      this.getConfig().catch(() => null),
    ]);
    const usdt = balance?.[0]?.details?.find((d) => d.ccy === 'USDT');
    return {
      configured: true,
      positions,
      equityUsd: orNull(usdt?.eq) ?? orNull(balance?.[0]?.totalEq),
      availableUsd: orNull(usdt?.availEq) ?? orNull(usdt?.availBal),
      totalMarginUsd: positions.reduce((s, p) => s + p.marginUsd, 0),
      totalUnrealizedPnlUsd: positions.reduce((s, p) => s + p.unrealizedPnlUsd, 0),
      posMode: config?.posMode ?? null,
      canTrade: config?.canTrade ?? null,
      fetchedAt,
    };
  }

  async getPositions(): Promise<OkxPosition[]> {
    const [rows, algos] = await Promise.all([
      this.request<PositionRaw[]>('GET', '/api/v5/account/positions', { instType: INST_TYPE }),
      this.listTpslAlgos().catch(() => [] as AlgoRaw[]),
    ]);
    const out: OkxPosition[] = [];
    for (const r of rows ?? []) {
      const signed = n(r.pos);
      if (!r.instId || !(Math.abs(signed) > 0)) continue;
      const ps = (r.posSide ?? '').toLowerCase();
      const holdSide: 'long' | 'short' = ps === 'long' || ps === 'short' ? ps : signed < 0 ? 'short' : 'long';
      const symbol = fromInstId(r.instId);
      const inst = await this.getInstrument(symbol).catch(() => null);
      const contracts = Math.abs(signed);
      const size = contracts * (inst?.ctVal ?? 1);
      const entry = n(r.avgPx);
      const mark = n(r.markPx);
      const margin = orNull(r.margin) ?? orNull(r.imr) ?? 0;
      const mine = algos.filter((a) => a.instId === r.instId && algoMatchesSide(a, ps || 'net', holdSide));
      const tp = mine.map((a) => orNull(a.tpTriggerPx)).find((x) => x != null) ?? null;
      const sl = mine.map((a) => orNull(a.slTriggerPx)).find((x) => x != null) ?? null;
      out.push({
        symbol,
        instId: r.instId,
        holdSide,
        marginMode: r.mgnMode ?? TD_MODE,
        leverage: n(r.lever) > 0 ? n(r.lever) : 1,
        size,
        contracts,
        entryPrice: entry,
        markPrice: Number.isFinite(mark) ? mark : entry,
        liquidationPrice: orNull(r.liqPx),
        marginUsd: margin,
        notionalUsd: orNull(r.notionalUsd) ?? size * (Number.isFinite(mark) ? mark : entry),
        unrealizedPnlUsd: Number.isFinite(n(r.upl)) ? n(r.upl) : 0,
        roePct: Number.isFinite(n(r.uplRatio)) ? n(r.uplRatio) * 100 : 0,
        takeProfitPrice: tp,
        stopLossPrice: sl,
        openedAt: n(r.cTime) > 0 ? new Date(n(r.cTime)).toISOString() : null,
        posId: r.posId ?? null,
      });
    }
    return out;
  }

  async getPosition(symbol: string, holdSide: 'long' | 'short'): Promise<OkxPosition | null> {
    const instId = toInstId(symbol);
    return (await this.getPositions()).find((p) => p.instId === instId && p.holdSide === holdSide) ?? null;
  }

  async listPendingOrders(symbol?: string): Promise<OkxPendingOrder[]> {
    const rows = await this.request<PendingRaw[]>('GET', '/api/v5/trade/orders-pending', {
      instType: INST_TYPE,
      ...(symbol ? { instId: toInstId(symbol) } : {}),
    });
    const out: OkxPendingOrder[] = [];
    for (const r of rows ?? []) {
      if (!r.instId || !r.ordId) continue;
      const sym = fromInstId(r.instId);
      const inst = await this.getInstrument(sym).catch(() => null);
      const contracts = n(r.sz);
      const price = n(r.px);
      const size = contracts * (inst?.ctVal ?? 1);
      const lev = orNull(r.lever);
      const ps = (r.posSide ?? '').toLowerCase();
      out.push({
        orderId: r.ordId,
        symbol: sym,
        holdSide: ps === 'long' || ps === 'short' ? ps : r.reduceOnly === 'true' ? null : r.side === 'sell' ? 'short' : 'long',
        side: r.side ?? '',
        orderType: r.ordType ?? '',
        price,
        size,
        contracts,
        leverage: lev,
        marginUsd: lev && price > 0 ? (size * price) / lev : null,
        reduceOnly: r.reduceOnly === 'true',
        createdAt: n(r.cTime) > 0 ? new Date(n(r.cTime)).toISOString() : null,
      });
    }
    return out;
  }

  // ── writes (only from a confirmed AI card) ─────────────────────────────────

  /** Open / add to a position. MARKET or LIMIT, optional TP attached to the order. */
  /** Writes fail fast with a clear message when the key is read-only. */
  private async assertCanTrade(): Promise<void> {
    const cfg = await this.getConfig();
    if (cfg.canTrade === false) {
      throw new BadRequestException('API key OKX chỉ có quyền đọc (read_only). Bật quyền Trade cho key, hoặc đặt OKX_TRADE_API_KEY/_SECRET/_PASSPHRASE bằng key có quyền Trade rồi restart API.');
    }
  }

  async placeOrder(input: {
    symbol: string;
    holdSide: 'long' | 'short';
    orderType: 'MARKET' | 'LIMIT';
    marginUsd: number;
    leverage: number;
    price?: number | null;
    takeProfitPrice?: number | null;
    /** Existing position: keep its leverage, do not call set-leverage. */
    keepLeverage?: boolean;
  }): Promise<{ orderId: string; contracts: string; size: number; refPrice: number; leverage: number; instId: string }> {
    await this.assertCanTrade();
    const inst = await this.getInstrument(input.symbol);
    const posMode = await this.getPosMode();
    const leverage = Math.max(1, Math.round(input.leverage));
    if (inst.maxLever && leverage > inst.maxLever) throw new BadRequestException(`Đòn bẩy tối đa của ${inst.instId} là ${inst.maxLever}×.`);
    if (!input.keepLeverage) {
      await this.request('POST', '/api/v5/account/set-leverage', undefined, { instId: inst.instId, lever: String(leverage), mgnMode: TD_MODE });
    }
    const refPrice = input.orderType === 'LIMIT' ? Number(input.price) : await this.getTickerPrice(input.symbol);
    if (!(refPrice > 0)) throw new BadRequestException('Thiếu giá limit.');
    const sz = contractsFromMargin(input.marginUsd, leverage, refPrice, inst);
    const body: Record<string, unknown> = {
      instId: inst.instId,
      tdMode: TD_MODE,
      side: input.holdSide === 'short' ? 'sell' : 'buy',
      ordType: input.orderType === 'LIMIT' ? 'limit' : 'market',
      sz,
    };
    if (posMode === 'long_short_mode') body.posSide = input.holdSide;
    if (input.orderType === 'LIMIT') body.px = this.priceStr(refPrice, inst);
    if (input.takeProfitPrice != null && input.takeProfitPrice > 0) {
      body.attachAlgoOrds = [{ tpTriggerPx: this.priceStr(input.takeProfitPrice, inst), tpOrdPx: '-1', tpTriggerPxType: 'last' }];
    }
    const res = await this.request<Array<{ ordId?: string; sCode?: string; sMsg?: string }>>('POST', '/api/v5/trade/order', undefined, body);
    const row = res?.[0];
    return { orderId: row?.ordId ?? '', contracts: sz, size: Number(sz) * inst.ctVal, refPrice, leverage, instId: inst.instId };
  }

  /**
   * Set / move the position-level take-profit. Replaces TP-only algos of that side;
   * an algo that also carries a SL (set by hand) is amended so the SL stays.
   * `null` removes the TP (TP-only algos are cancelled).
   */
  async setTakeProfit(symbol: string, holdSide: 'long' | 'short', takeProfitPrice: number | null): Promise<{ prevTp: number | null; tp: number | null }> {
    await this.assertCanTrade();
    const inst = await this.getInstrument(symbol);
    const posMode = await this.getPosMode();
    const ps = posMode === 'long_short_mode' ? holdSide : 'net';
    const algos = (await this.listTpslAlgos()).filter((a) => a.instId === inst.instId && algoMatchesSide(a, ps, holdSide));
    const prevTp = algos.map((a) => orNull(a.tpTriggerPx)).find((x) => x != null) ?? null;
    const tpOnly = algos.filter((a) => orNull(a.tpTriggerPx) != null && orNull(a.slTriggerPx) == null);
    const withSl = algos.filter((a) => orNull(a.slTriggerPx) != null);

    if (tpOnly.length) {
      await this.request('POST', '/api/v5/trade/cancel-algos', undefined, tpOnly.map((a) => ({ algoId: a.algoId, instId: inst.instId })));
    }
    if (takeProfitPrice == null) return { prevTp, tp: null };
    const tpStr = this.priceStr(takeProfitPrice, inst);
    if (withSl.length) {
      await this.request('POST', '/api/v5/trade/amend-algos', undefined, {
        instId: inst.instId,
        algoId: withSl[0]!.algoId,
        newTpTriggerPx: tpStr,
        newTpOrdPx: '-1',
        newTpTriggerPxType: 'last',
      });
      return { prevTp, tp: takeProfitPrice };
    }
    const body: Record<string, unknown> = {
      instId: inst.instId,
      tdMode: TD_MODE,
      side: holdSide === 'short' ? 'buy' : 'sell',
      ordType: 'conditional',
      tpTriggerPx: tpStr,
      tpOrdPx: '-1',
      tpTriggerPxType: 'last',
      closeFraction: '1',
    };
    if (posMode === 'long_short_mode') body.posSide = holdSide;
    else body.reduceOnly = true;
    await this.request('POST', '/api/v5/trade/order-algo', undefined, body);
    return { prevTp, tp: takeProfitPrice };
  }

  /** Close `pct`% of a position at market (100 = close-position endpoint, cancels its pending closes). */
  async closePosition(symbol: string, holdSide: 'long' | 'short', pct: number): Promise<{ orderId: string | null; closedContracts: number; remainingContracts: number; markPrice: number }> {
    await this.assertCanTrade();
    const position = await this.getPosition(symbol, holdSide);
    if (!position) throw new BadRequestException(`Không có vị thế ${holdSide.toUpperCase()} ${symbol} trên OKX.`);
    const inst = await this.getInstrument(symbol);
    const posMode = await this.getPosMode();
    const share = Math.min(100, Math.max(1, pct)) / 100;
    if (share >= 1) {
      await this.request('POST', '/api/v5/trade/close-position', undefined, {
        instId: inst.instId,
        mgnMode: position.marginMode || TD_MODE,
        ...(posMode === 'long_short_mode' ? { posSide: holdSide } : {}),
        autoCxl: true,
      });
      return { orderId: null, closedContracts: position.contracts, remainingContracts: 0, markPrice: position.markPrice };
    }
    const sz = floorToStep(position.contracts * share, inst.lotSz);
    if (!(Number(sz) >= inst.minSz)) throw new BadRequestException(`Phần đóng quá nhỏ (< ${inst.minSz} hợp đồng). Tăng % đóng.`);
    const body: Record<string, unknown> = {
      instId: inst.instId,
      tdMode: position.marginMode || TD_MODE,
      side: holdSide === 'short' ? 'buy' : 'sell',
      ordType: 'market',
      sz,
    };
    if (posMode === 'long_short_mode') body.posSide = holdSide;
    else body.reduceOnly = true;
    const res = await this.request<Array<{ ordId?: string }>>('POST', '/api/v5/trade/order', undefined, body);
    return { orderId: res?.[0]?.ordId ?? null, closedContracts: Number(sz), remainingContracts: position.contracts - Number(sz), markPrice: position.markPrice };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<{ orderId: string }> {
    await this.assertCanTrade();
    await this.request('POST', '/api/v5/trade/cancel-order', undefined, { instId: toInstId(symbol), ordId: orderId });
    return { orderId };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private priceStr(price: number, inst: OkxInstrument): string {
    if (!(inst.tickSz > 0)) return String(price);
    const d = decimalsOf(inst.tickSz);
    return (Math.round(price / inst.tickSz) * inst.tickSz).toFixed(d);
  }

  /** Pending TP/SL algos (conditional + oco) of every SWAP. */
  private async listTpslAlgos(): Promise<AlgoRaw[]> {
    const [cond, oco] = await Promise.all([
      this.request<AlgoRaw[]>('GET', '/api/v5/trade/orders-algo-pending', { ordType: 'conditional', instType: INST_TYPE }),
      this.request<AlgoRaw[]>('GET', '/api/v5/trade/orders-algo-pending', { ordType: 'oco', instType: INST_TYPE }).catch(() => [] as AlgoRaw[]),
    ]);
    return [...(cond ?? []), ...(oco ?? [])];
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, string | number>,
    body?: unknown,
    signed = true,
  ): Promise<T> {
    if (signed && !this.isConfigured()) throw new BadRequestException('OKX chưa cấu hình API key (OKX_TRADE_API_* hoặc OKX_API_*).');
    const qs = Object.entries(query ?? {})
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    const requestPath = qs ? `${path}?${qs}` : path;
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.simulated) headers['x-simulated-trading'] = '1';
    if (signed) {
      const ts = new Date().toISOString();
      headers['OK-ACCESS-KEY'] = this.apiKey;
      headers['OK-ACCESS-SIGN'] = createHmac('sha256', this.apiSecret).update(`${ts}${method}${requestPath}${payload}`).digest('base64');
      headers['OK-ACCESS-TIMESTAMP'] = ts;
      headers['OK-ACCESS-PASSPHRASE'] = this.passphrase;
    }
    let data: Envelope<T>;
    try {
      const res = await this.http.request<Envelope<T>>({ method, url: requestPath, data: payload || undefined, headers });
      data = res.data;
    } catch (e) {
      const resp = (e as { response?: { data?: Envelope<Array<{ sMsg?: string }>> } }).response?.data;
      if (resp?.code) throw new BadRequestException(okxError(path, resp.code, resp.msg, resp.data));
      throw e;
    }
    if (data?.code != null && data.code !== '0') {
      throw new BadRequestException(okxError(path, data.code, data.msg, data.data as unknown as Array<{ sCode?: string; sMsg?: string }>));
    }
    // Batch-style endpoints answer code 0 with a per-row sCode.
    const rows = Array.isArray(data.data) ? (data.data as Array<{ sCode?: string; sMsg?: string }>) : [];
    const bad = rows.find((r) => r && r.sCode != null && r.sCode !== '0');
    if (bad) throw new BadRequestException(`OKX ${path}: ${bad.sCode} ${bad.sMsg ?? ''}`.trim());
    return data.data;
  }
}

/** A TP/SL algo belongs to the position of this side (long/short mode) or the net position. */
function algoMatchesSide(a: AlgoRaw, posSide: string, holdSide: 'long' | 'short'): boolean {
  const ps = (a.posSide ?? '').toLowerCase();
  if (ps === 'long' || ps === 'short') return ps === holdSide;
  // Net mode: a closing algo of a short buys, of a long sells.
  if (posSide === 'net' || ps === 'net') return a.side ? a.side === (holdSide === 'short' ? 'buy' : 'sell') : true;
  return false;
}

function okxError(path: string, code: string, msg?: string, rows?: Array<{ sCode?: string; sMsg?: string }> | unknown): string {
  const detail = Array.isArray(rows) ? (rows as Array<{ sCode?: string; sMsg?: string }>).find((r) => r?.sMsg)?.sMsg : undefined;
  const hint = code === '50120' || code === '50119' || code === '50110' ? ' — API key thiếu quyền Trade hoặc IP chưa được whitelist.' : '';
  return `OKX ${path} lỗi ${code}: ${detail || msg || ''}${hint}`.trim();
}
