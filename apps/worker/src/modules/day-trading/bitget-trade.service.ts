import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import axios, { type AxiosInstance, type Method } from 'axios';
import { withRetry } from './retry.util';

/**
 * Authenticated Bitget v2 mix (USDT-futures) REST client — the LIVE-mode order
 * layer for the day-trading bot. PAPER mode never touches this; it is only
 * called from SignalExecutorService when LIVE_TRADING_ENABLED is on.
 *
 * Credentials come from env (account API key with **Trade** permission, no
 * Withdraw, IP-whitelisted to the server). They are read lazily so the worker
 * still boots in PAPER mode when the keys are absent — methods throw a clear
 * error only when actually invoked without credentials.
 *
 * Signing (Bitget v2): prehash = timestamp + METHOD + requestPath(+query) + body
 *   ACCESS-SIGN = base64(HMAC_SHA256(prehash, secret))
 * Headers: ACCESS-KEY, ACCESS-SIGN, ACCESS-TIMESTAMP, ACCESS-PASSPHRASE.
 *
 * ⚠️ Idempotency: every order carries a stable `clientOid` (the signal id) so
 * Bitget rejects duplicates. That is what would later make it safe to wrap the
 * place/close calls in `withRetry`. Until reconciliation also exists (see
 * day-trading.md "REQUIRED before LIVE"), place/close run **single-attempt** —
 * a thrown error is surfaced to the caller, never silently retried.
 */

const BASE_URL = 'https://api.bitget.com';
const MARGIN_COIN = 'USDT';

// Default leverage for LIVE positions. With a small account ($50) this is set
// explicitly (not left to the account default) so margin/liquidation are
// deterministic. Position SIZE is risk-based and independent of leverage; at
// 10x isolated the liquidation is ~9-10% away while the SL sits at ~0.5%, so the
// stop always triggers long before liquidation. Override via BITGET_LEVERAGE.
const DEFAULT_LEVERAGE = '10';

export type OrderDirection = 'LONG' | 'SHORT';

/**
 * Thrown for a Bitget business error (non-`00000` code). Carries the exchange
 * `code` so the executor can persist it in the ORDER_FAILED audit detail for
 * later tracing (e.g. "40762" = insufficient margin).
 */
export class BitgetApiError extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'BitgetApiError';
  }
}

export type PlaceOrderParams = {
  symbol: string;            // e.g. "BTCUSDT"
  direction: OrderDirection; // LONG → buy, SHORT → sell
  size: number;              // position size in base asset (BTC)
  takeProfit: number;        // REQUIRED — attached as a preset TP on the position
  stopLoss: number;          // REQUIRED — attached as a preset SL on the position
  clientOid: string;         // stable id (signal id) — exchange-side idempotency
  marginMode?: 'isolated' | 'crossed'; // default isolated
};

export type PlacedOrder = {
  orderId: string;
  clientOid: string;
};

export type BitgetPosition = {
  symbol: string;
  holdSide: 'long' | 'short';
  size: number;          // open size in base asset
  averageOpenPrice: number;
  unrealizedPnl: number;
  marginMode: string;
};

export type BitgetOrder = {
  orderId: string;
  clientOid: string;
  state: string;         // live | partially_filled | filled | canceled
  size: number;
  priceAvg: number;      // average fill price (0 until filled)
};

type BitgetEnvelope<T> = {
  code: string;
  msg: string;
  requestTime: number;
  data: T;
};

// BTCUSDT futures precision on Bitget. Sizes/prices outside the contract's
// volumePlace/pricePlace are rejected, so we floor to these before sending.
// TODO: for symbols other than BTCUSDT, read these from /api/v2/mix/market/contracts.
const SIZE_DECIMALS = 3;  // BTCUSDT volumePlace
const PRICE_DECIMALS = 1; // BTCUSDT pricePlace

@Injectable()
export class BitgetTradeService {
  private readonly logger = new Logger(BitgetTradeService.name);
  private readonly client: AxiosInstance;

  private readonly apiKey = process.env.BITGET_API_KEY ?? '';
  private readonly apiSecret = process.env.BITGET_API_SECRET ?? '';
  private readonly passphrase = process.env.BITGET_API_PASSPHRASE ?? '';
  // usdt-futures (real) | susdt-futures (demo)
  private readonly productType = process.env.BITGET_PRODUCT_TYPE ?? 'usdt-futures';
  private readonly leverage = process.env.BITGET_LEVERAGE ?? DEFAULT_LEVERAGE;

  constructor() {
    this.client = axios.create({ baseURL: BASE_URL, timeout: 10_000 });
  }

  /** True only when all three credentials are present. Callers should gate on this. */
  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.passphrase);
  }

  /**
   * Set leverage for a symbol/side. Called before the first order so margin and
   * liquidation are deterministic rather than inheriting the account default.
   * In isolated mode leverage is per side, so pass `holdSide`. Read-modify op on
   * the account — single-attempt; a failure here aborts the entry upstream.
   */
  async setLeverage(symbol: string, holdSide: 'long' | 'short', leverage?: string): Promise<void> {
    this.assertConfigured();
    const body: Record<string, string> = {
      symbol,
      productType: this.productType,
      marginCoin: MARGIN_COIN,
      leverage: leverage ?? this.leverage,
      holdSide,
    };
    try {
      await this.request<unknown>('POST', '/api/v2/mix/account/set-leverage', undefined, body);
      this.logger.log(`Bitget leverage set: ${symbol} ${holdSide} ${body.leverage}x`);
    } catch (err) {
      this.logError('setLeverage', { symbol, holdSide, leverage: body.leverage }, err);
      throw err;
    }
  }

  /**
   * Open a market position with preset TP/SL attached.
   *
   * The exchange fills the TP/SL itself (limit/stop on the position) — the bot's
   * result monitor must NOT be relied on to exit a LIVE trade. Single-attempt:
   * a failure throws so the caller can audit ORDER_FAILED and skip, rather than
   * risk a duplicate order via a blind retry. The error is also logged here
   * immediately (pm2 logs) with full context for tracing.
   */
  async placeOrder(params: PlaceOrderParams): Promise<PlacedOrder> {
    this.assertConfigured();
    // Hard rule: a LIVE position must never be naked. Reject before hitting the
    // exchange if either protective level is missing — the preset TP/SL is the
    // exchange-side exit, not the bot's result monitor.
    if (params.takeProfit == null || params.stopLoss == null) {
      throw new Error(
        `placeOrder refused: TP and SL are required (got TP=${params.takeProfit}, SL=${params.stopLoss})`,
      );
    }
    const body: Record<string, string> = {
      symbol: params.symbol,
      productType: this.productType,
      marginMode: params.marginMode ?? 'isolated',
      marginCoin: MARGIN_COIN,
      size: this.fmt(params.size, SIZE_DECIMALS),
      side: params.direction === 'LONG' ? 'buy' : 'sell',
      orderType: 'market',
      clientOid: params.clientOid,
      presetStopSurplusPrice: this.fmt(params.takeProfit, PRICE_DECIMALS), // TP limit
      presetStopLossPrice: this.fmt(params.stopLoss, PRICE_DECIMALS), // SL stop
    };

    try {
      const data = await this.request<{ orderId: string; clientOid: string }>(
        'POST',
        '/api/v2/mix/order/place-order',
        undefined,
        body,
      );
      this.logger.log(
        `Bitget order placed: ${params.direction} ${params.symbol} size ${body.size} ` +
          `orderId ${data.orderId} clientOid ${data.clientOid}`,
      );
      return { orderId: data.orderId, clientOid: data.clientOid };
    } catch (err) {
      this.logError('placeOrder', { ...body }, err);
      throw err;
    }
  }

  /**
   * Flash-close the open position at market (reduce-only). Used for force-close
   * and as the LIVE exit path. Single-attempt for the same idempotency reason.
   * `holdSide` is optional in one-way mode; pass it in hedge mode.
   */
  async closePosition(symbol: string, holdSide?: 'long' | 'short'): Promise<void> {
    this.assertConfigured();
    const body: Record<string, string> = {
      symbol,
      productType: this.productType,
    };
    if (holdSide) body.holdSide = holdSide;

    try {
      await this.request<unknown>('POST', '/api/v2/mix/order/close-positions', undefined, body);
      this.logger.log(`Bitget position closed: ${symbol}${holdSide ? ` (${holdSide})` : ''}`);
    } catch (err) {
      this.logError('closePosition', { symbol, holdSide: holdSide ?? '' }, err);
      throw err;
    }
  }

  /**
   * Current open position for a symbol (optionally a specific side), or null if
   * flat. Read-only and idempotent → safe to retry. The reconciliation job uses
   * this as the source of truth for whether a DB-ACTIVE signal is really open.
   */
  async getPosition(symbol: string, holdSide?: 'long' | 'short'): Promise<BitgetPosition | null> {
    this.assertConfigured();
    const query = { symbol, productType: this.productType, marginCoin: MARGIN_COIN };
    const data = await withRetry(
      () =>
        this.request<
          Array<{
            symbol: string;
            holdSide: 'long' | 'short';
            total: string;
            openPriceAvg: string;
            unrealizedPL: string;
            marginMode: string;
          }>
        >('GET', '/api/v2/mix/position/single-position', query),
      { label: `getPosition(${symbol})`, logger: this.logger, isRetryable: isNetworkError },
    );

    const open = data.find(
      (p) => Number(p.total) > 0 && (holdSide ? p.holdSide === holdSide : true),
    );
    if (!open) return null;
    return {
      symbol: open.symbol,
      holdSide: open.holdSide,
      size: Number(open.total),
      averageOpenPrice: Number(open.openPriceAvg),
      unrealizedPnl: Number(open.unrealizedPL),
      marginMode: open.marginMode,
    };
  }

  /**
   * Order detail by orderId or clientOid. Read-only → safe to retry. Used to read
   * the real fill price/PnL for a closed order (LIVE source of truth, not the WS
   * tick).
   */
  async getOrder(
    symbol: string,
    ids: { orderId?: string; clientOid?: string },
  ): Promise<BitgetOrder | null> {
    this.assertConfigured();
    if (!ids.orderId && !ids.clientOid) {
      throw new Error('getOrder requires orderId or clientOid');
    }
    const query: Record<string, string> = { symbol, productType: this.productType };
    if (ids.orderId) query.orderId = ids.orderId;
    if (ids.clientOid) query.clientOid = ids.clientOid;

    const data = await withRetry(
      () =>
        this.request<{
          orderId: string;
          clientOid: string;
          state: string;
          size: string;
          priceAvg: string;
        } | null>('GET', '/api/v2/mix/order/detail', query),
      { label: `getOrder(${symbol})`, logger: this.logger, isRetryable: isNetworkError },
    );
    if (!data) return null;
    return {
      orderId: data.orderId,
      clientOid: data.clientOid,
      state: data.state,
      size: Number(data.size),
      priceAvg: Number(data.priceAvg),
    };
  }

  /**
   * Most recent CLOSED position for a side since `sinceMs`, or null if none yet.
   * Read-only → safe to retry. This is the LIVE source of truth for the exit:
   * `closeAvgPrice` is the real fill and `netProfit` the real realized PnL
   * (after fees), which the reconciliation job writes back instead of a WS tick.
   * Returns null while the history feed lags so the caller leaves the row ACTIVE.
   */
  async getClosedPosition(
    symbol: string,
    holdSide: 'long' | 'short',
    sinceMs: number,
  ): Promise<{ closeAvgPrice: number; netProfit: number; closedAtMs: number } | null> {
    this.assertConfigured();
    const query = {
      symbol,
      productType: this.productType,
      startTime: String(sinceMs),
      limit: '50',
    };
    const data = await withRetry(
      () =>
        this.request<{
          list: Array<{
            symbol: string;
            holdSide: 'long' | 'short';
            closeAvgPrice: string;
            netProfit: string;
            utime: string;
          }> | null;
        } | null>('GET', '/api/v2/mix/position/history-position', query),
      { label: `getClosedPosition(${symbol})`, logger: this.logger, isRetryable: isNetworkError },
    );
    const list = data?.list ?? [];
    const match = list
      .filter((p) => p.symbol === symbol && p.holdSide === holdSide && Number(p.utime) >= sinceMs)
      .sort((a, b) => Number(b.utime) - Number(a.utime))[0];
    if (!match) return null;
    return {
      closeAvgPrice: Number(match.closeAvgPrice),
      netProfit: Number(match.netProfit),
      closedAtMs: Number(match.utime),
    };
  }

  // --- internals ---------------------------------------------------------

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        'BitgetTradeService called without credentials — set BITGET_API_KEY / ' +
          'BITGET_API_SECRET / BITGET_API_PASSPHRASE before enabling LIVE trading.',
      );
    }
  }

  /**
   * Signed request. `query` (GET params) is folded into the requestPath BEFORE
   * signing — Bitget signs the full path-with-query. `body` is the JSON payload
   * for POST. Throws on transport error or a non-`00000` business code.
   */
  private async request<T>(
    method: Extract<Method, 'GET' | 'POST'>,
    path: string,
    query?: Record<string, string>,
    body?: Record<string, string>,
  ): Promise<T> {
    const timestamp = Date.now().toString();
    const queryString = query
      ? new URLSearchParams(
          // stable order: Bitget signs exactly the string it receives
          Object.keys(query)
            .sort()
            .map((k) => [k, query[k]] as [string, string]),
        ).toString()
      : '';
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const bodyString = body ? JSON.stringify(body) : '';

    const prehash = timestamp + method + requestPath + bodyString;
    const sign = createHmac('sha256', this.apiSecret).update(prehash).digest('base64');

    const response = await this.client.request<BitgetEnvelope<T>>({
      method,
      url: requestPath,
      data: method === 'POST' ? bodyString : undefined,
      headers: {
        'ACCESS-KEY': this.apiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': this.passphrase,
        'Content-Type': 'application/json',
        locale: 'en-US',
      },
    });

    if (response.data.code !== '00000') {
      throw new BitgetApiError(
        response.data.code,
        path,
        `Bitget ${path} error ${response.data.code}: ${response.data.msg}`,
      );
    }
    return response.data.data;
  }

  /**
   * Immediate, structured error log for the order-mutating paths — lands in the
   * pm2 worker log right away with the request context and (when present) the
   * Bitget business code, so a failed entry is traceable without the DB. The
   * durable, signal-scoped ORDER_FAILED audit is written by the caller.
   */
  private logError(op: string, context: Record<string, unknown>, err: unknown): void {
    const code = err instanceof BitgetApiError ? err.code : 'n/a';
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`Bitget ${op} failed [code ${code}] ctx=${JSON.stringify(context)}: ${msg}`);
  }

  /** Floor to the contract's decimals (extra precision is rejected by Bitget). */
  private fmt(value: number, decimals: number): string {
    const factor = 10 ** decimals;
    return (Math.floor(value * factor) / factor).toFixed(decimals);
  }
}

/**
 * Only network/5xx errors are worth retrying on the read paths. A Bitget
 * business error (non-`00000`, e.g. bad param / insufficient margin) is
 * permanent — fail fast instead of hammering.
 */
function isNetworkError(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    return !err.response || err.response.status >= 500;
  }
  // request() throws plain Error for business codes → not retryable.
  return false;
}
