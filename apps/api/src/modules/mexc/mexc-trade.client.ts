import { createHmac } from 'node:crypto';
import axios, { type AxiosInstance, type Method } from 'axios';

/**
 * Authenticated MEXC futures (contract) client for the API — the counterpart of
 * `BitgetTradeClient`, deliberately kept as its own file so the two exchange
 * integrations can never break each other.
 *
 * Differences from Bitget that shape everything below:
 *  - **Signing**: `HMAC-SHA256(accessKey + timestamp + paramString)` in HEX,
 *    sent as `ApiKey` / `Request-Time` / `Signature` headers. `paramString` is
 *    the alphabetically-sorted query string for GET and the raw JSON body for
 *    POST. There is no passphrase.
 *  - **Symbols** are `BTC_USDT`, not `BTCUSDT`. The whole app speaks `BTCUSDT`
 *    (that's what Binance charting needs), so conversion happens at this
 *    boundary only — every method takes/returns the app format.
 *  - **Volumes are in CONTRACTS**, not base asset: 1 contract = `contractSize`
 *    of the coin. Callers work in base asset; `contractSize` conversion also
 *    lives here.
 *  - **Sides** are numeric: 1 = open long, 2 = close short, 3 = open short,
 *    4 = close long. There is no "close position" endpoint — closing is a
 *    market order on the opposite side, carrying the `positionId`.
 *
 * API base moved to `https://api.mexc.com` on 2026-01-19 (the old
 * `https://contract.mexc.com` host is the fallback) — override with
 * `MEXC_API_BASE_URL` if MEXC moves it again.
 */

const BASE_URL = process.env.MEXC_API_BASE_URL ?? 'https://api.mexc.com';
const MARGIN_COIN = 'USDT';

/** MEXC wraps every response in `{ success, code, data }`; `code: 0` is OK. */
type MexcEnvelope<T> = { success?: boolean; code?: number; message?: string; msg?: string; data: T };

/** `side` codes for `/order/create`. */
const SIDE_OPEN_LONG = 1;
const SIDE_CLOSE_SHORT = 2;
const SIDE_OPEN_SHORT = 3;
const SIDE_CLOSE_LONG = 4;
/** `type` code for a market order. */
const ORDER_TYPE_MARKET = 5;
/** `openType` code for cross margin (the mode the Setup tab opens in). */
const OPEN_TYPE_CROSS = 2;
/**
 * TP/SL trigger price type: 1 = latest, 2 = fair, 3 = index. Fair price is the
 * closest analogue to Bitget's `mark_price` and to the "Giá hiện tại" column,
 * so triggers fire on the same number the dashboard shows.
 */
const TPSL_TREND_FAIR = 2;
/** `volType` for a TP/SL that closes the WHOLE position (1 = partial). */
const TPSL_VOL_TYPE_POSITION = 2;
/** TP/SL fill type: 0 = market, 1 = limit. */
const TPSL_ORDER_TYPE_MARKET = 0;

/** App symbol (`BTCUSDT`) → MEXC contract symbol (`BTC_USDT`). */
export function toMexcSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('_')) return s;
  return s.endsWith(MARGIN_COIN) ? `${s.slice(0, -MARGIN_COIN.length)}_${MARGIN_COIN}` : s;
}

/** MEXC contract symbol (`BTC_USDT`) → app symbol (`BTCUSDT`). */
export function fromMexcSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace('_', '');
}

/** One row from `/api/v1/private/position/open_positions`, in app terms. */
export type MexcRawPosition = {
  positionId: number;
  /** App-format symbol (`BTCUSDT`). */
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  /** Position size in the BASE asset (contracts × contractSize). */
  size: number;
  /** Raw MEXC size, in contracts — needed to close or set TP/SL on it. */
  holdVol: number;
  openAvgPrice: number;
  holdAvgPrice: number;
  liquidatePrice: number | null;
  /** Initial margin currently committed, USDT. */
  im: number;
  leverage: number;
  /** Unrealized PnL as MEXC reports it; null when the field is absent. */
  unrealizedPnl: number | null;
  realised: number;
  createTime: number;
  updateTime: number;
  /** Margin mode code (1 = isolated, 2 = cross) — echoed back when closing. */
  openType: number;
};

/** One live TP/SL order from `/api/v1/private/stoporder/open_orders`. */
export type MexcStopOrder = {
  id: number;
  positionId: number;
  symbol: string;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  holdSide: 'long' | 'short';
  createTime: number;
};

/** Contract precision + minimums from `/api/v1/contract/detail`. */
export type MexcContractSpec = {
  /** Base-asset amount of ONE contract — the base⇄contracts conversion factor. */
  contractSize: number;
  /** Decimal places allowed for price. */
  priceScale: number;
  /** Decimal places allowed for volume (contracts). */
  volScale: number;
  /** Minimum order size, in contracts. */
  minVol: number;
  /** Maximum leverage the contract allows. */
  maxLeverage: number;
  /** MEXC's own flag for whether API trading is permitted on this contract. */
  apiAllowed: boolean;
};

export class MexcTradeClient {
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 8_000 });
  private readonly apiKey = process.env.MEXC_API_KEY ?? '';
  private readonly apiSecret = process.env.MEXC_API_SECRET ?? '';
  /** Contract specs barely change — cache them for the process lifetime. */
  private readonly specCache = new Map<string, MexcContractSpec>();

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  /** Current last-traded price for a symbol (public market data). */
  async getTickerPrice(symbol: string): Promise<number> {
    const price = await this.getTicker(symbol).then((t) => t.lastPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`No live price for ${symbol}`);
    return price;
  }

  /** Last + fair price for a symbol (public market data). */
  async getTicker(symbol: string): Promise<{ lastPrice: number; fairPrice: number }> {
    const data = await this.request<
      { symbol: string; lastPrice: number; fairPrice: number } | Array<{ symbol: string; lastPrice: number; fairPrice: number }>
    >('GET', '/api/v1/contract/ticker', { symbol: toMexcSymbol(symbol) }, undefined, { signed: false });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error(`No ticker for ${symbol}`);
    return { lastPrice: Number(row.lastPrice), fairPrice: Number(row.fairPrice) };
  }

  /** Fair prices for many symbols in ONE public call, keyed by app symbol. */
  async getFairPrices(): Promise<Record<string, number>> {
    const data = await this.request<Array<{ symbol: string; lastPrice: number; fairPrice: number }>>(
      'GET',
      '/api/v1/contract/ticker',
      undefined,
      undefined,
      { signed: false },
    );
    const out: Record<string, number> = {};
    for (const row of data ?? []) {
      const px = Number(row.fairPrice ?? row.lastPrice);
      if (row.symbol && Number.isFinite(px)) out[fromMexcSymbol(row.symbol)] = px;
    }
    return out;
  }

  /** Contract precision/minimums for a symbol (public market data, cached). */
  async getContractSpec(symbol: string): Promise<MexcContractSpec> {
    const app = fromMexcSymbol(symbol);
    const cached = this.specCache.get(app);
    if (cached) return cached;

    const data = await this.request<
      | {
          symbol: string;
          contractSize: number;
          priceScale: number;
          volScale: number;
          minVol: number;
          maxLeverage: number;
          apiAllowed?: boolean;
        }
      | Array<{
          symbol: string;
          contractSize: number;
          priceScale: number;
          volScale: number;
          minVol: number;
          maxLeverage: number;
          apiAllowed?: boolean;
        }>
    >('GET', '/api/v1/contract/detail', { symbol: toMexcSymbol(symbol) }, undefined, { signed: false });

    const row = Array.isArray(data) ? data.find((c) => c.symbol === toMexcSymbol(symbol)) ?? data[0] : data;
    if (!row) throw new Error(`No contract spec for ${symbol}`);
    const spec: MexcContractSpec = {
      contractSize: Number(row.contractSize) || 1,
      priceScale: Number(row.priceScale) || 4,
      volScale: Number(row.volScale) || 0,
      minVol: Number(row.minVol) || 1,
      maxLeverage: Number(row.maxLeverage) || 125,
      // Absent flag is treated as allowed — MEXC only sets it false on contracts
      // that are explicitly API-blocked, and a missing field must not block a
      // trade the exchange would have accepted.
      apiAllowed: row.apiAllowed !== false,
    };
    this.specCache.set(app, spec);
    return spec;
  }

  /** Contract size (base asset per contract) for a symbol — 1 if unknown. */
  async getContractSize(symbol: string): Promise<number> {
    return this.getContractSpec(symbol)
      .then((s) => s.contractSize)
      .catch(() => 1);
  }

  /**
   * Set leverage before the first order so margin/liquidation are deterministic
   * rather than inheriting the account default. MEXC needs `symbol` + `openType`
   * + `positionType` when NO position is open yet, and `positionId` when one is
   * — this takes the flat-account path, which is the only one we use (leverage
   * is never changed under a live position).
   */
  async setCrossLeverage(symbol: string, holdSide: 'long' | 'short', leverage: number): Promise<void> {
    await this.request<unknown>('POST', '/api/v1/private/position/change_leverage', undefined, {
      symbol: toMexcSymbol(symbol),
      leverage: Math.round(leverage),
      openType: OPEN_TYPE_CROSS,
      positionType: holdSide === 'long' ? 1 : 2,
    });
  }

  /**
   * Open a market position in CROSS mode. `size` is in the BASE asset — it is
   * converted to contracts here. `price` is required by MEXC even on a market
   * order (it is used as the protection cap), so the caller passes the live one.
   */
  async openMarketPosition(params: {
    symbol: string;
    holdSide: 'long' | 'short';
    /** Order size in CONTRACTS (already floored to `volScale`). */
    vol: number;
    price: number;
    leverage: number;
    externalOid: string;
  }): Promise<void> {
    await this.request<unknown>('POST', '/api/v1/private/order/create', undefined, {
      symbol: toMexcSymbol(params.symbol),
      price: params.price,
      vol: params.vol,
      leverage: Math.round(params.leverage),
      side: params.holdSide === 'long' ? SIDE_OPEN_LONG : SIDE_OPEN_SHORT,
      type: ORDER_TYPE_MARKET,
      openType: OPEN_TYPE_CROSS,
      externalOid: params.externalOid,
    });
  }

  /** Every open position across all symbols, or [] if the account is flat. */
  async getAllPositions(): Promise<MexcRawPosition[]> {
    const data = await this.request<RawPositionRow[]>('GET', '/api/v1/private/position/open_positions');
    const rows = (data ?? []).filter((p) => Number(p.holdVol) > 0);
    // One spec lookup per distinct symbol, to convert contracts → base asset.
    const sizes = new Map<string, number>();
    for (const app of new Set(rows.map((r) => fromMexcSymbol(r.symbol ?? '')))) {
      if (app) sizes.set(app, await this.getContractSize(app));
    }
    return rows.map((p) => this.mapRawPosition(p, sizes.get(fromMexcSymbol(p.symbol ?? '')) ?? 1));
  }

  /** The open position for a side, or null if the exchange is flat on that side. */
  async getPosition(symbol: string, holdSide: 'long' | 'short'): Promise<MexcRawPosition | null> {
    const data = await this.request<RawPositionRow[]>('GET', '/api/v1/private/position/open_positions', {
      symbol: toMexcSymbol(symbol),
    });
    const wanted = holdSide === 'long' ? 1 : 2;
    const row = (data ?? []).find((p) => p.positionType === wanted && Number(p.holdVol) > 0);
    if (!row) return null;
    return this.mapRawPosition(row, await this.getContractSize(symbol));
  }

  /** Open size for a side in the BASE asset, or 0 if the exchange is flat. */
  async getPositionSize(symbol: string, holdSide: 'long' | 'short'): Promise<number> {
    const open = await this.getPosition(symbol, holdSide);
    return open ? open.size : 0;
  }

  /**
   * Flash-close an open position at market. MEXC has no dedicated close
   * endpoint: it is a market order on the CLOSING side for the position's full
   * contract volume, carrying `positionId` so the exchange reduces that exact
   * position instead of opening a hedge.
   */
  async closePosition(position: MexcRawPosition, price: number): Promise<void> {
    await this.request<unknown>('POST', '/api/v1/private/order/create', undefined, {
      symbol: toMexcSymbol(position.symbol),
      price,
      vol: position.holdVol,
      side: position.holdSide === 'long' ? SIDE_CLOSE_LONG : SIDE_CLOSE_SHORT,
      type: ORDER_TYPE_MARKET,
      openType: position.openType,
      positionId: position.positionId,
    });
  }

  /**
   * Set the position-level take-profit / stop-loss on the exchange, so MEXC
   * itself closes the position when a trigger is hit (nothing depends on this
   * app being up). Sends both sides in one order covering the whole position;
   * the caller cancels superseded ones separately.
   */
  async placePositionTpsl(params: {
    position: MexcRawPosition;
    takeProfitPrice?: number;
    stopLossPrice?: number;
  }): Promise<void> {
    const body: Record<string, unknown> = {
      positionId: params.position.positionId,
      vol: params.position.holdVol,
      volType: TPSL_VOL_TYPE_POSITION,
      profitLossVolType: 'SAME',
      profitTrend: TPSL_TREND_FAIR,
      lossTrend: TPSL_TREND_FAIR,
      takeProfitType: TPSL_ORDER_TYPE_MARKET,
      stopLossType: TPSL_ORDER_TYPE_MARKET,
    };
    if (params.takeProfitPrice != null) body.takeProfitPrice = params.takeProfitPrice;
    if (params.stopLossPrice != null) body.stopLossPrice = params.stopLossPrice;
    await this.request<unknown>('POST', '/api/v1/private/stoporder/place', undefined, body);
  }

  /** Live (untriggered) TP/SL orders for one symbol. */
  async getPendingTpslOrders(symbol: string): Promise<MexcStopOrder[]> {
    const data = await this.request<RawStopOrderRow[]>('GET', '/api/v1/private/stoporder/open_orders', {
      symbol: toMexcSymbol(symbol),
    });
    return (data ?? []).map((o) => ({
      id: Number(o.id),
      positionId: Number(o.positionId),
      symbol: fromMexcSymbol(o.symbol ?? symbol),
      takeProfitPrice: positiveOrNull(o.takeProfitPrice),
      stopLossPrice: positiveOrNull(o.stopLossPrice),
      holdSide: o.positionType === 2 ? 'short' : 'long',
      createTime: Number(o.createTime),
    }));
  }

  /** Cancel live TP/SL orders by their stop-order ids (max 50 per call). */
  async cancelTpslOrders(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.request<unknown>('POST', '/api/v1/private/stoporder/cancel', undefined, ids.slice(0, 50).map((id) => ({
      stopPlanOrderId: id,
    })));
  }

  /**
   * USDT futures-wallet balance: total equity (incl. unrealized PnL), the free
   * balance and the margin in use. Returns null when the wallet has no USDT row.
   */
  async getAccountBalance(): Promise<{
    accountEquity: number;
    available: number;
    positionMargin: number;
    unrealizedPL: number;
  } | null> {
    const data = await this.request<{
      currency?: string;
      equity?: number;
      availableBalance?: number;
      positionMargin?: number;
      unrealized?: number;
    } | null>('GET', `/api/v1/private/account/asset/${MARGIN_COIN}`);
    if (!data) return null;
    return {
      accountEquity: Number(data.equity),
      available: Number(data.availableBalance),
      positionMargin: Number(data.positionMargin),
      unrealizedPL: Number(data.unrealized),
    };
  }

  /** Shape one raw MEXC position row, converting contracts → base asset. */
  private mapRawPosition(p: RawPositionRow, contractSize: number): MexcRawPosition {
    const holdVol = Number(p.holdVol);
    const liquidate = Number(p.liquidatePrice);
    const unrealized = p.unRealizedPnl ?? p.unrealizedPnl;
    return {
      positionId: Number(p.positionId),
      symbol: fromMexcSymbol(p.symbol ?? ''),
      holdSide: p.positionType === 2 ? 'short' : 'long',
      marginMode: p.openType === 1 ? 'isolated' : 'crossed',
      size: holdVol * (contractSize > 0 ? contractSize : 1),
      holdVol,
      openAvgPrice: Number(p.openAvgPrice),
      holdAvgPrice: Number(p.holdAvgPrice ?? p.openAvgPrice),
      liquidatePrice: Number.isFinite(liquidate) && liquidate > 0 ? liquidate : null,
      im: Number(p.im ?? p.oim),
      leverage: Number(p.leverage),
      unrealizedPnl: unrealized != null && Number.isFinite(Number(unrealized)) ? Number(unrealized) : null,
      realised: Number(p.realised),
      createTime: Number(p.createTime),
      updateTime: Number(p.updateTime),
      openType: Number(p.openType) || OPEN_TYPE_CROSS,
    };
  }

  /**
   * Signed (or public) MEXC request.
   *
   * Signing target is `accessKey + timestamp + paramString`, hex HMAC-SHA256:
   * `paramString` is the alphabetically-sorted query string on GET and the raw
   * JSON body on POST — so the exact string that is signed MUST be the exact
   * string that is sent, which is why the body is serialized once here.
   */
  private async request<T>(
    method: Extract<Method, 'GET' | 'POST'>,
    path: string,
    query?: Record<string, string | number>,
    body?: unknown,
    opts: { signed?: boolean } = {},
  ): Promise<T> {
    const signed = opts.signed !== false;
    if (signed && !this.isConfigured()) {
      throw new Error('MEXC credentials not configured');
    }

    const entries = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null);
    const queryString = entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const bodyString = body !== undefined ? JSON.stringify(body) : '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (signed) {
      const timestamp = Date.now().toString();
      const target = this.apiKey + timestamp + (method === 'POST' ? bodyString : queryString);
      headers.ApiKey = this.apiKey;
      headers['Request-Time'] = timestamp;
      headers.Signature = createHmac('sha256', this.apiSecret).update(target).digest('hex');
      headers['Recv-Window'] = '30';
    }

    const res = await this.client.request<MexcEnvelope<T>>({
      method,
      url: requestPath,
      data: method === 'POST' ? bodyString : undefined,
      headers,
    });

    const env = res.data;
    if (env?.success === false || (env?.code != null && env.code !== 0)) {
      throw new Error(`MEXC ${path} error ${env.code}: ${env.message ?? env.msg ?? 'unknown error'}`);
    }
    return env.data;
  }
}

/** Raw open-position row as MEXC returns it (before symbol/size conversion). */
type RawPositionRow = {
  positionId?: number;
  symbol?: string;
  positionType?: number;
  openType?: number;
  holdVol?: number;
  openAvgPrice?: number;
  holdAvgPrice?: number;
  liquidatePrice?: number;
  im?: number;
  oim?: number;
  leverage?: number;
  realised?: number;
  unRealizedPnl?: number;
  unrealizedPnl?: number;
  createTime?: number;
  updateTime?: number;
};

/** Raw TP/SL order row from `stoporder/open_orders`. */
type RawStopOrderRow = {
  id?: number;
  positionId?: number;
  symbol?: string;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  positionType?: number;
  createTime?: number;
};

/** MEXC sends 0 (not null) for an unset TP/SL side — normalize those away. */
function positiveOrNull(v: number | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
