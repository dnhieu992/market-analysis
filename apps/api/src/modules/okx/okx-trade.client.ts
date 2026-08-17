import { createHmac } from 'node:crypto';
import axios, { type AxiosInstance, type Method } from 'axios';

/**
 * Authenticated OKX V5 USDT-perpetual (SWAP) client for the API — the
 * counterpart of `BitgetTradeClient` / `MexcTradeClient`, deliberately kept as
 * its own file so the three exchange integrations can never break each other.
 *
 * Differences from Bitget/MEXC that shape everything below:
 *  - **Signing**: `HMAC-SHA256(timestamp + METHOD + requestPath + body)` in
 *    BASE64, sent as `OK-ACCESS-KEY` / `-SIGN` / `-TIMESTAMP` / `-PASSPHRASE`.
 *    The timestamp is an ISO-8601 string with milliseconds (NOT epoch ms), and
 *    `requestPath` includes the query string — so the exact bytes signed must be
 *    the exact bytes sent, which is why the URL and body are built once here.
 *    Unlike MEXC there IS a passphrase (the one set when creating the API key).
 *  - **Symbols** are `BTC-USDT-SWAP`, not `BTCUSDT`. The whole app speaks
 *    `BTCUSDT` (that's what Binance charting needs), so conversion happens at
 *    this boundary only — every method takes/returns the app format.
 *  - **Sizes are in CONTRACTS**, not base asset: 1 contract = `ctVal` of the
 *    coin. Callers work in base asset; the conversion also lives here.
 *  - **Position mode**: OKX accounts are either in `net_mode` (one netted
 *    position per instrument, `posSide` is the literal `"net"` and `pos` is
 *    signed) or `long_short_mode` (a long and a short can be open at once).
 *    Both are supported: the mode is read once from `/account/config` and cached,
 *    and `posSide` is only sent on orders when the account is in long/short mode.
 *  - **TP/SL is an ALGO ORDER**, not a field on the position: it is placed on
 *    `/trade/order-algo` and carries no position id, so it is matched back to a
 *    position by `(instId, posSide)` rather than by `positionId`.
 *
 * `OKX_API_BASE_URL` overrides the host (e.g. an `aws.okx.com` mirror), and
 * `OKX_SIMULATED=true` routes everything to the demo-trading account.
 */

const BASE_URL = process.env.OKX_API_BASE_URL ?? 'https://www.okx.com';
const MARGIN_COIN = 'USDT';
/** OKX instrument family the dashboard trades — USDT-margined perpetual swaps. */
const INST_TYPE = 'SWAP';
/** Every position the dashboard opens is cross margin (matches the Setup tab). */
const MARGIN_MODE = 'cross';
/** `ordPx` sentinel that makes a triggered algo order fill at market. */
const ALGO_MARKET_PX = '-1';
/**
 * Trigger price type for TP/SL: mark price is the closest analogue to Bitget's
 * `mark_price` and to the "Giá hiện tại" column, so triggers fire on the same
 * number the dashboard shows.
 */
const TRIGGER_PX_TYPE = 'mark';
/** OKX caps `cancel-algos` at 10 orders per request. */
const MAX_CANCEL_ALGOS = 10;
/** OKX rejects a `clOrdId` longer than this. */
const MAX_CL_ORD_ID = 32;

/** OKX wraps every response in `{ code, msg, data }`; `code: "0"` is OK. */
type OkxEnvelope<T> = { code?: string; msg?: string; data: T };

/** App symbol (`BTCUSDT`) → OKX instrument id (`BTC-USDT-SWAP`). */
export function toOkxInstId(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('-')) return s.endsWith(`-${INST_TYPE}`) ? s : `${s}-${INST_TYPE}`;
  const base = s.endsWith(MARGIN_COIN) ? s.slice(0, -MARGIN_COIN.length) : s;
  return `${base}-${MARGIN_COIN}-${INST_TYPE}`;
}

/** OKX instrument id (`BTC-USDT-SWAP`) → app symbol (`BTCUSDT`). */
export function fromOkxInstId(instId: string): string {
  const parts = instId.trim().toUpperCase().split('-');
  if (parts.length < 2) return instId.trim().toUpperCase();
  return `${parts[0]}${parts[1]}`;
}

/**
 * Client-side order id for `/trade/order`. Nothing reads it back — it only has
 * to be unique and to fit OKX's 32-char alphanumeric cap, so the side/timestamp/
 * random part is fixed-width and the symbol takes whatever budget is left over.
 */
export function buildClOrdId(symbol: string, holdSide: 'long' | 'short'): string {
  const side = holdSide === 'long' ? 'L' : 'S';
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  const base = fromOkxInstId(symbol).replace(/[^A-Z0-9]/g, '');
  return `${side}${base.slice(0, MAX_CL_ORD_ID - side.length - stamp.length - rand.length)}${stamp}${rand}`;
}

/** One row from `/api/v5/account/positions`, in app terms. */
export type OkxRawPosition = {
  /** OKX `posId` — stable for the life of the position. */
  positionId: string;
  /** App-format symbol (`BTCUSDT`). */
  symbol: string;
  /** Wire instrument id (`BTC-USDT-SWAP`) — needed for every follow-up call. */
  instId: string;
  holdSide: 'long' | 'short';
  /** Raw OKX `posSide`: `long` / `short` / `net`. Echoed back on close + TP/SL. */
  posSide: string;
  marginMode: string;
  /** Position size in the BASE asset (contracts × ctVal). */
  size: number;
  /** Raw OKX size, in contracts (always positive) — needed to close it. */
  pos: number;
  avgPx: number;
  markPx: number;
  /** Break-even price incl. fees, as OKX reports it; null when absent. */
  bePx: number | null;
  liqPx: number | null;
  /** Initial margin currently committed, USDT. */
  imr: number;
  leverage: number;
  /** Unrealized PnL as OKX reports it; null when the field is absent. */
  upl: number | null;
  realizedPnl: number;
  createTime: number;
  updateTime: number;
};

/** One live TP/SL algo order from `/api/v5/trade/orders-algo-pending`. */
export type OkxAlgoOrder = {
  algoId: string;
  instId: string;
  /** App-format symbol (`BTCUSDT`). */
  symbol: string;
  /** Raw OKX `posSide` the order closes. */
  posSide: string;
  holdSide: 'long' | 'short';
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  createTime: number;
};

/** Instrument precision + minimums from `/api/v5/public/instruments`. */
export type OkxInstrumentSpec = {
  /** Base-asset amount of ONE contract — the base⇄contracts conversion factor. */
  ctVal: number;
  /** Price tick size (e.g. 0.1). */
  tickSz: number;
  /** Decimal places implied by `tickSz` — used to round TP/SL prices. */
  priceScale: number;
  /** Order size step, in contracts. */
  lotSz: number;
  /** Minimum order size, in contracts. */
  minSz: number;
  /** Maximum leverage the instrument allows. */
  maxLeverage: number;
  /** OKX only lets you trade an instrument whose `state` is `live`. */
  live: boolean;
};

/** Decimal places implied by a tick/lot size string like "0.001" or "1". */
function scaleOf(step: string | number | undefined): number {
  const s = String(step ?? '');
  const dot = s.indexOf('.');
  if (dot < 0) return 0;
  return s.length - dot - 1;
}

const numOr = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** OKX sends "" (not null) for an unset TP/SL side — normalize those away. */
function positiveOrNull(v: string | number | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export class OkxTradeClient {
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 8_000 });
  private readonly apiKey = process.env.OKX_API_KEY ?? '';
  private readonly apiSecret = process.env.OKX_API_SECRET ?? '';
  private readonly passphrase = process.env.OKX_API_PASSPHRASE ?? '';
  /** Demo-trading flag — sends every request to OKX's paper account. */
  private readonly simulated = process.env.OKX_SIMULATED === 'true';
  /** Instrument specs barely change — cache them for the process lifetime. */
  private readonly specCache = new Map<string, OkxInstrumentSpec>();
  /** `net_mode` | `long_short_mode`, read once from `/account/config`. */
  private posModeCache: string | null = null;

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.passphrase);
  }

  /** Current last-traded price for a symbol (public market data). */
  async getTickerPrice(symbol: string): Promise<number> {
    const price = await this.getTicker(symbol).then((t) => t.lastPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`No live price for ${symbol}`);
    return price;
  }

  /**
   * Last + mark price for a symbol (public market data). The mark price comes
   * from its own endpoint — OKX's ticker carries only the traded last price.
   */
  async getTicker(symbol: string): Promise<{ lastPrice: number; markPrice: number }> {
    const instId = toOkxInstId(symbol);
    const [tickers, marks] = await Promise.all([
      this.request<Array<{ last?: string }>>('GET', '/api/v5/market/ticker', { instId }, undefined, {
        signed: false,
      }),
      this.request<Array<{ markPx?: string }>>(
        'GET',
        '/api/v5/public/mark-price',
        { instType: INST_TYPE, instId },
        undefined,
        { signed: false },
      ).catch(() => [] as Array<{ markPx?: string }>),
    ]);
    const lastPrice = Number(tickers?.[0]?.last);
    if (!Number.isFinite(lastPrice)) throw new Error(`No ticker for ${symbol}`);
    return { lastPrice, markPrice: numOr(marks?.[0]?.markPx, lastPrice) };
  }

  /** Mark prices for every SWAP in ONE public call, keyed by app symbol. */
  async getMarkPrices(): Promise<Record<string, number>> {
    const rows = await this.request<Array<{ instId?: string; markPx?: string }>>(
      'GET',
      '/api/v5/public/mark-price',
      { instType: INST_TYPE },
      undefined,
      { signed: false },
    );
    const out: Record<string, number> = {};
    for (const row of rows ?? []) {
      const px = Number(row.markPx);
      if (row.instId && Number.isFinite(px)) out[fromOkxInstId(row.instId)] = px;
    }
    return out;
  }

  /** Instrument precision/minimums for a symbol (public market data, cached). */
  async getInstrumentSpec(symbol: string): Promise<OkxInstrumentSpec> {
    const app = fromOkxInstId(toOkxInstId(symbol));
    const cached = this.specCache.get(app);
    if (cached) return cached;

    const instId = toOkxInstId(symbol);
    const rows = await this.request<
      Array<{
        instId?: string;
        ctVal?: string;
        tickSz?: string;
        lotSz?: string;
        minSz?: string;
        lever?: string;
        state?: string;
      }>
    >('GET', '/api/v5/public/instruments', { instType: INST_TYPE, instId }, undefined, { signed: false });

    const row = (rows ?? []).find((r) => r.instId === instId) ?? rows?.[0];
    if (!row) throw new Error(`No instrument spec for ${symbol}`);
    const spec: OkxInstrumentSpec = {
      ctVal: numOr(row.ctVal, 1) || 1,
      tickSz: numOr(row.tickSz, 0.0001),
      priceScale: scaleOf(row.tickSz),
      lotSz: numOr(row.lotSz, 1) || 1,
      minSz: numOr(row.minSz, 1) || 1,
      maxLeverage: numOr(row.lever, 125),
      // A missing `state` is treated as tradable — OKX only sets it to something
      // other than `live` on suspended/expired instruments, and a missing field
      // must not block a trade the exchange would have accepted.
      live: row.state == null || row.state === 'live',
    };
    this.specCache.set(app, spec);
    return spec;
  }

  /** Contract value (base asset per contract) for a symbol — 1 if unknown. */
  async getContractSize(symbol: string): Promise<number> {
    return this.getInstrumentSpec(symbol)
      .then((s) => s.ctVal)
      .catch(() => 1);
  }

  /**
   * Whether the account nets long and short into one position (`net_mode`) or
   * keeps them apart (`long_short_mode`). Read once and cached: it decides
   * whether `posSide` may be sent on an order at all — sending it in net mode is
   * rejected, omitting it in long/short mode is ambiguous.
   *
   * Defaults to `net_mode` when the config call fails, because that is OKX's own
   * account default.
   */
  async getPositionMode(): Promise<string> {
    if (this.posModeCache) return this.posModeCache;
    const rows = await this.request<Array<{ posMode?: string }>>('GET', '/api/v5/account/config').catch(
      () => [] as Array<{ posMode?: string }>,
    );
    this.posModeCache = rows?.[0]?.posMode ?? 'net_mode';
    return this.posModeCache;
  }

  /** True when the account keeps long and short as separate positions. */
  private async isLongShortMode(): Promise<boolean> {
    return (await this.getPositionMode()) === 'long_short_mode';
  }

  /**
   * Set leverage before the first order so margin/liquidation are deterministic
   * rather than inheriting the account default. In cross margin OKX wants the
   * per-side leverage in long/short mode and a single value in net mode.
   */
  async setCrossLeverage(symbol: string, holdSide: 'long' | 'short', leverage: number): Promise<void> {
    const body: Record<string, unknown> = {
      instId: toOkxInstId(symbol),
      lever: String(Math.round(leverage)),
      mgnMode: MARGIN_MODE,
    };
    if (await this.isLongShortMode()) body.posSide = holdSide;
    await this.request<unknown>('POST', '/api/v5/account/set-leverage', undefined, body);
  }

  /**
   * Open a market position in CROSS mode. `sz` is in CONTRACTS (already floored
   * to `lotSz` by the caller). Unlike MEXC, OKX needs no price on a market order.
   */
  async openMarketPosition(params: {
    symbol: string;
    holdSide: 'long' | 'short';
    /** Order size in CONTRACTS. */
    sz: number;
    clOrdId: string;
  }): Promise<void> {
    const body: Record<string, unknown> = {
      instId: toOkxInstId(params.symbol),
      tdMode: MARGIN_MODE,
      side: params.holdSide === 'long' ? 'buy' : 'sell',
      ordType: 'market',
      sz: String(params.sz),
      clOrdId: params.clOrdId,
    };
    if (await this.isLongShortMode()) body.posSide = params.holdSide;
    await this.request<unknown>('POST', '/api/v5/trade/order', undefined, body);
  }

  /** Every open position across all symbols, or [] if the account is flat. */
  async getAllPositions(): Promise<OkxRawPosition[]> {
    const rows = await this.request<RawPositionRow[]>('GET', '/api/v5/account/positions', {
      instType: INST_TYPE,
    });
    const open = (rows ?? []).filter((p) => Math.abs(Number(p.pos)) > 0);
    // One spec lookup per distinct symbol, to convert contracts → base asset.
    const sizes = new Map<string, number>();
    for (const app of new Set(open.map((r) => fromOkxInstId(r.instId ?? '')))) {
      if (app) sizes.set(app, await this.getContractSize(app));
    }
    return open.map((p) => this.mapRawPosition(p, sizes.get(fromOkxInstId(p.instId ?? '')) ?? 1));
  }

  /** The open position for a side, or null if the exchange is flat on that side. */
  async getPosition(symbol: string, holdSide: 'long' | 'short'): Promise<OkxRawPosition | null> {
    const rows = await this.request<RawPositionRow[]>('GET', '/api/v5/account/positions', {
      instType: INST_TYPE,
      instId: toOkxInstId(symbol),
    });
    const open = (rows ?? []).filter((p) => Math.abs(Number(p.pos)) > 0);
    const ctVal = await this.getContractSize(symbol);
    return open.map((p) => this.mapRawPosition(p, ctVal)).find((p) => p.holdSide === holdSide) ?? null;
  }

  /** Open size for a side in the BASE asset, or 0 if the exchange is flat. */
  async getPositionSize(symbol: string, holdSide: 'long' | 'short'): Promise<number> {
    const open = await this.getPosition(symbol, holdSide);
    return open ? open.size : 0;
  }

  /**
   * Flash-close an open position at market. OKX has a dedicated endpoint for
   * this, so — unlike MEXC — no size or price has to be passed. `autoCxl` drops
   * any pending order on the instrument so the close cannot be blocked by one.
   */
  async closePosition(position: OkxRawPosition): Promise<void> {
    const body: Record<string, unknown> = {
      instId: position.instId,
      mgnMode: position.marginMode === 'isolated' ? 'isolated' : MARGIN_MODE,
      autoCxl: true,
    };
    // `net` is the literal posSide OKX reports in net mode; it must be echoed
    // back rather than replaced with the derived long/short direction.
    if (position.posSide && position.posSide !== 'net') body.posSide = position.posSide;
    await this.request<unknown>('POST', '/api/v5/trade/close-position', undefined, body);
  }

  /**
   * Set the position-level take-profit / stop-loss on the exchange, so OKX itself
   * closes the position when a trigger is hit (nothing depends on this app being
   * up). `closeFraction: "1"` covers the WHOLE position, including any volume
   * added later, so the trigger never goes stale against a scaled-in position.
   *
   * `ordType` is `oco` when both sides are set and `conditional` for a single
   * side — OKX rejects an `oco` order that carries only one trigger.
   */
  async placePositionTpsl(params: {
    position: OkxRawPosition;
    takeProfitPrice?: number;
    stopLossPrice?: number;
  }): Promise<void> {
    const both = params.takeProfitPrice != null && params.stopLossPrice != null;
    const body: Record<string, unknown> = {
      instId: params.position.instId,
      tdMode: params.position.marginMode === 'isolated' ? 'isolated' : MARGIN_MODE,
      // The closing side is the opposite of the position's direction.
      side: params.position.holdSide === 'long' ? 'sell' : 'buy',
      ordType: both ? 'oco' : 'conditional',
      closeFraction: '1',
    };
    if (params.position.posSide && params.position.posSide !== 'net') {
      body.posSide = params.position.posSide;
    } else {
      // Net mode: without an explicit side OKX would treat the algo order as a
      // fresh entry once triggered.
      body.reduceOnly = true;
    }
    if (params.takeProfitPrice != null) {
      body.tpTriggerPx = String(params.takeProfitPrice);
      body.tpOrdPx = ALGO_MARKET_PX;
      body.tpTriggerPxType = TRIGGER_PX_TYPE;
    }
    if (params.stopLossPrice != null) {
      body.slTriggerPx = String(params.stopLossPrice);
      body.slOrdPx = ALGO_MARKET_PX;
      body.slTriggerPxType = TRIGGER_PX_TYPE;
    }
    await this.request<unknown>('POST', '/api/v5/trade/order-algo', undefined, body);
  }

  /**
   * Change the trigger prices of an algo order that is already live, so the
   * position stays protected throughout the update. Only prices already present
   * on the order can be amended — adding or removing a side needs a replace, so
   * the caller falls back to cancel-then-place for those.
   */
  async amendPositionTpsl(params: {
    instId: string;
    algoId: string;
    takeProfitPrice?: number;
    stopLossPrice?: number;
  }): Promise<void> {
    const body: Record<string, unknown> = { instId: params.instId, algoId: params.algoId };
    if (params.takeProfitPrice != null) {
      body.newTpTriggerPx = String(params.takeProfitPrice);
      body.newTpOrdPx = ALGO_MARKET_PX;
      body.newTpTriggerPxType = TRIGGER_PX_TYPE;
    }
    if (params.stopLossPrice != null) {
      body.newSlTriggerPx = String(params.stopLossPrice);
      body.newSlOrdPx = ALGO_MARKET_PX;
      body.newSlTriggerPxType = TRIGGER_PX_TYPE;
    }
    await this.request<unknown>('POST', '/api/v5/trade/amend-algos', undefined, body);
  }

  /**
   * Live (untriggered) TP/SL algo orders for one symbol. OKX requires an explicit
   * `ordType` on this endpoint and keeps one-sided (`conditional`) and two-sided
   * (`oco`) triggers in separate buckets, so both are queried and merged.
   */
  async getPendingTpslOrders(symbol: string): Promise<OkxAlgoOrder[]> {
    const instId = toOkxInstId(symbol);
    const buckets = await Promise.all(
      (['oco', 'conditional'] as const).map((ordType) =>
        this.request<RawAlgoRow[]>('GET', '/api/v5/trade/orders-algo-pending', {
          instType: INST_TYPE,
          instId,
          ordType,
        }).catch(() => [] as RawAlgoRow[]),
      ),
    );
    return buckets.flat().map((o) => {
      const posSide = o.posSide ?? 'net';
      // In net mode the algo order carries no direction — it closes whatever is
      // open, so its side is the OPPOSITE of the order's own buy/sell.
      const holdSide: 'long' | 'short' =
        posSide === 'long' || posSide === 'short' ? posSide : o.side === 'sell' ? 'long' : 'short';
      return {
        algoId: String(o.algoId ?? ''),
        instId: o.instId ?? instId,
        symbol: fromOkxInstId(o.instId ?? instId),
        posSide,
        holdSide,
        takeProfitPrice: positiveOrNull(o.tpTriggerPx),
        stopLossPrice: positiveOrNull(o.slTriggerPx),
        createTime: numOr(o.cTime, 0),
      };
    });
  }

  /** Cancel live TP/SL algo orders (max 10 per call — OKX's own cap). */
  async cancelTpslOrders(orders: Array<{ instId: string; algoId: string }>): Promise<void> {
    if (orders.length === 0) return;
    await this.request<unknown>(
      'POST',
      '/api/v5/trade/cancel-algos',
      undefined,
      orders.slice(0, MAX_CANCEL_ALGOS).map(({ instId, algoId }) => ({ instId, algoId })),
    );
  }

  /**
   * USDT trading-account balance: total equity (incl. unrealized PnL), the free
   * balance and the margin in use. Returns null when the account has no USDT row.
   */
  async getAccountBalance(): Promise<{
    accountEquity: number;
    available: number;
    positionMargin: number;
    unrealizedPL: number;
  } | null> {
    const rows = await this.request<
      Array<{
        totalEq?: string;
        details?: Array<{
          ccy?: string;
          eq?: string;
          availEq?: string;
          availBal?: string;
          frozenBal?: string;
          imr?: string;
          upl?: string;
        }>;
      }>
    >('GET', '/api/v5/account/balance', { ccy: MARGIN_COIN });

    const account = rows?.[0];
    if (!account) return null;
    const usdt = (account.details ?? []).find((d) => d.ccy === MARGIN_COIN) ?? account.details?.[0];
    if (!usdt) return null;
    return {
      accountEquity: numOr(usdt.eq, numOr(account.totalEq, 0)),
      available: numOr(usdt.availEq, numOr(usdt.availBal, 0)),
      positionMargin: numOr(usdt.imr, numOr(usdt.frozenBal, 0)),
      unrealizedPL: numOr(usdt.upl, 0),
    };
  }

  /** Shape one raw OKX position row, converting contracts → base asset. */
  private mapRawPosition(p: RawPositionRow, ctVal: number): OkxRawPosition {
    const posSide = p.posSide ?? 'net';
    const signedPos = numOr(p.pos, 0);
    // Net mode reports ONE signed position; long/short mode reports a positive
    // size plus an explicit side.
    const holdSide: 'long' | 'short' =
      posSide === 'long' || posSide === 'short' ? posSide : signedPos < 0 ? 'short' : 'long';
    const pos = Math.abs(signedPos);
    const avgPx = numOr(p.avgPx, 0);
    const upl = p.upl != null && p.upl !== '' && Number.isFinite(Number(p.upl)) ? Number(p.upl) : null;

    return {
      positionId: String(p.posId ?? ''),
      symbol: fromOkxInstId(p.instId ?? ''),
      instId: p.instId ?? '',
      holdSide,
      posSide,
      marginMode: p.mgnMode === 'isolated' ? 'isolated' : 'crossed',
      size: pos * (ctVal > 0 ? ctVal : 1),
      pos,
      avgPx,
      markPx: numOr(p.markPx, avgPx),
      bePx: positiveOrNull(p.bePx),
      liqPx: positiveOrNull(p.liqPx),
      // Cross positions report `imr`; isolated ones report `margin`.
      imr: numOr(p.imr, numOr(p.margin, 0)),
      leverage: numOr(p.lever, 0),
      upl,
      realizedPnl: numOr(p.realizedPnl, 0),
      createTime: numOr(p.cTime, 0),
      updateTime: numOr(p.uTime, 0),
    };
  }

  /**
   * Signed (or public) OKX V5 request.
   *
   * Signing target is `timestamp + METHOD + requestPath + body`, base64
   * HMAC-SHA256 — where `requestPath` INCLUDES the query string and `body` is the
   * raw JSON string (empty on GET). The exact string signed MUST be the exact
   * string sent, which is why both are serialized once here.
   */
  private async request<T>(
    method: Extract<Method, 'GET' | 'POST'>,
    path: string,
    query?: Record<string, string | number | undefined>,
    body?: unknown,
    opts: { signed?: boolean } = {},
  ): Promise<T> {
    const signed = opts.signed !== false;
    if (signed && !this.isConfigured()) {
      throw new Error('OKX credentials not configured');
    }

    const entries = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
    const queryString = entries.map(([k, v]) => `${k}=${v}`).join('&');
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const bodyString = body !== undefined ? JSON.stringify(body) : '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.simulated) headers['x-simulated-trading'] = '1';
    if (signed) {
      // OKX wants an ISO-8601 timestamp WITH milliseconds, not epoch ms.
      const timestamp = new Date().toISOString();
      const prehash = `${timestamp}${method}${requestPath}${bodyString}`;
      headers['OK-ACCESS-KEY'] = this.apiKey;
      headers['OK-ACCESS-SIGN'] = createHmac('sha256', this.apiSecret).update(prehash).digest('base64');
      headers['OK-ACCESS-TIMESTAMP'] = timestamp;
      headers['OK-ACCESS-PASSPHRASE'] = this.passphrase;
    }

    const res = await this.client.request<OkxEnvelope<T>>({
      method,
      url: requestPath,
      data: method === 'POST' ? bodyString : undefined,
      headers,
    });

    const env = res.data;
    if (env?.code != null && env.code !== '0') {
      // On a partially-failed batch OKX keeps the top-level code non-zero and puts
      // the real reason in the first row's `sMsg` — surface that instead of the
      // generic "Operation failed".
      const first = Array.isArray(env.data) ? (env.data[0] as { sCode?: string; sMsg?: string }) : undefined;
      const detail = first?.sMsg || env.msg || 'unknown error';
      throw new Error(`OKX ${path} error ${first?.sCode ?? env.code}: ${detail}`);
    }
    return env.data;
  }
}

/** Raw position row as OKX returns it (before symbol/size conversion). */
type RawPositionRow = {
  posId?: string;
  instId?: string;
  posSide?: string;
  mgnMode?: string;
  pos?: string;
  avgPx?: string;
  markPx?: string;
  bePx?: string;
  liqPx?: string;
  imr?: string;
  margin?: string;
  lever?: string;
  upl?: string;
  realizedPnl?: string;
  cTime?: string;
  uTime?: string;
};

/** Raw algo-order row from `orders-algo-pending`. */
type RawAlgoRow = {
  algoId?: string;
  instId?: string;
  posSide?: string;
  side?: string;
  tpTriggerPx?: string;
  slTriggerPx?: string;
  cTime?: string;
};
