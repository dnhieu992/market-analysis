import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import axios, { type AxiosInstance, type Method } from 'axios';
import { withRetry } from './retry.util';

/**
 * Authenticated Bitget v2 mix (USDT-futures) REST client for the Long Signal bot.
 *
 * Unlike the day-trading client (BTCUSDT-only, hardcoded precision), this one
 * trades a BASKET of alts (POL/XRP/SOL/TAO/…), so it reads each contract's
 * size/price precision and minimum size from /api/v2/mix/market/contracts and
 * caches it. PAPER mode never calls this; it is only used in LIVE mode.
 *
 * Signing (Bitget v2): prehash = timestamp + METHOD + requestPath(+query) + body;
 *   ACCESS-SIGN = base64(HMAC_SHA256(prehash, secret)).
 */

const BASE_URL = 'https://api.bitget.com';
const MARGIN_COIN = 'USDT';

export class BitgetApiError extends Error {
  constructor(readonly code: string, readonly path: string, message: string) {
    super(message);
    this.name = 'BitgetApiError';
  }
}

export type PlaceLongParams = {
  symbol: string;
  size: number;        // position size in base asset
  takeProfit: number;  // preset TP on the position
  stopLoss: number;    // preset (catastrophe) SL on the position
  clientOid: string;   // stable id (signal id) — exchange-side idempotency
};

export type ContractSpec = { sizeDecimals: number; priceDecimals: number; minTradeNum: number };

type BitgetEnvelope<T> = { code: string; msg: string; requestTime: number; data: T };

@Injectable()
export class LongSignalTradeService {
  private readonly logger = new Logger(LongSignalTradeService.name);
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 10_000 });

  private readonly apiKey = process.env.BITGET_API_KEY ?? '';
  private readonly apiSecret = process.env.BITGET_API_SECRET ?? '';
  private readonly passphrase = process.env.BITGET_API_PASSPHRASE ?? '';
  private readonly productType = process.env.BITGET_PRODUCT_TYPE ?? 'usdt-futures';
  private readonly hedgeMode = (process.env.BITGET_POSITION_MODE ?? 'hedge') !== 'one-way';

  private readonly specCache = new Map<string, ContractSpec>();

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.passphrase);
  }

  /** Per-symbol size/price precision + min size, read once from the public contracts endpoint. */
  async getContractSpec(symbol: string): Promise<ContractSpec> {
    const cached = this.specCache.get(symbol);
    if (cached) return cached;
    const data = await withRetry(
      () =>
        this.request<Array<{ symbol: string; volumePlace: string; pricePlace: string; minTradeNum: string }>>(
          'GET',
          '/api/v2/mix/market/contracts',
          { symbol, productType: this.productType },
          undefined,
          /* signed */ false,
        ),
      { label: `getContractSpec(${symbol})`, logger: this.logger, isRetryable: isNetworkError },
    );
    const row = data.find((d) => d.symbol === symbol) ?? data[0];
    const spec: ContractSpec = {
      sizeDecimals: row ? Number(row.volumePlace) : 4,
      priceDecimals: row ? Number(row.pricePlace) : 2,
      minTradeNum: row ? Number(row.minTradeNum) : 0,
    };
    this.specCache.set(symbol, spec);
    return spec;
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    this.assertConfigured();
    const body: Record<string, string> = {
      symbol,
      productType: this.productType,
      marginCoin: MARGIN_COIN,
      leverage: String(leverage),
      holdSide: 'long',
    };
    try {
      await this.request<unknown>('POST', '/api/v2/mix/account/set-leverage', undefined, body);
      this.logger.log(`Bitget leverage set: ${symbol} long ${leverage}x`);
    } catch (err) {
      this.logError('setLeverage', { symbol, leverage }, err);
      throw err;
    }
  }

  /** Open a LONG market position with preset TP/SL attached. Single-attempt. */
  async placeLong(params: PlaceLongParams): Promise<{ orderId: string; clientOid: string }> {
    this.assertConfigured();
    if (params.takeProfit == null || params.stopLoss == null) {
      throw new Error(`placeLong refused: TP and SL required (TP=${params.takeProfit}, SL=${params.stopLoss})`);
    }
    const spec = await this.getContractSpec(params.symbol);
    const size = this.fmt(params.size, spec.sizeDecimals);
    if (Number(size) <= 0 || (spec.minTradeNum > 0 && Number(size) < spec.minTradeNum)) {
      throw new Error(
        `placeLong refused: size ${params.size} → ${size} below contract minimum ${spec.minTradeNum} for ${params.symbol}`,
      );
    }
    const body: Record<string, string> = {
      symbol: params.symbol,
      productType: this.productType,
      marginMode: 'isolated',
      marginCoin: MARGIN_COIN,
      size,
      side: 'buy',
      orderType: 'market',
      clientOid: params.clientOid,
      presetStopSurplusPrice: this.fmt(params.takeProfit, spec.priceDecimals),
      presetStopLossPrice: this.fmt(params.stopLoss, spec.priceDecimals),
    };
    if (this.hedgeMode) body.tradeSide = 'open';

    try {
      const data = await this.request<{ orderId: string; clientOid: string }>(
        'POST',
        '/api/v2/mix/order/place-order',
        undefined,
        body,
      );
      this.logger.log(`Bitget LONG placed: ${params.symbol} size ${size} orderId ${data.orderId}`);
      return { orderId: data.orderId, clientOid: data.clientOid };
    } catch (err) {
      this.logError('placeLong', { ...body }, err);
      throw err;
    }
  }

  /** Flash-close the LONG position at market (reduce-only). Single-attempt. */
  async closeLong(symbol: string): Promise<void> {
    this.assertConfigured();
    const body: Record<string, string> = { symbol, productType: this.productType };
    if (this.hedgeMode) body.holdSide = 'long';
    try {
      await this.request<unknown>('POST', '/api/v2/mix/order/close-positions', undefined, body);
      this.logger.log(`Bitget LONG closed: ${symbol}`);
    } catch (err) {
      this.logError('closeLong', { symbol }, err);
      throw err;
    }
  }

  /** Current open LONG position for a symbol, or null if flat. Read-only → retried. */
  async getLongPosition(symbol: string): Promise<{ size: number; averageOpenPrice: number } | null> {
    this.assertConfigured();
    const query = { symbol, productType: this.productType, marginCoin: MARGIN_COIN };
    const data = await withRetry(
      () =>
        this.request<Array<{ holdSide: 'long' | 'short'; total: string; openPriceAvg: string }>>(
          'GET',
          '/api/v2/mix/position/single-position',
          query,
        ),
      { label: `getLongPosition(${symbol})`, logger: this.logger, isRetryable: isNetworkError },
    );
    const open = data.find((p) => p.holdSide === 'long' && Number(p.total) > 0);
    if (!open) return null;
    return { size: Number(open.total), averageOpenPrice: Number(open.openPriceAvg) };
  }

  /** Most recent CLOSED long since `sinceMs` — real fill + realized PnL (after fees). */
  async getClosedLong(
    symbol: string,
    sinceMs: number,
  ): Promise<{ closeAvgPrice: number; netProfit: number; closedAtMs: number } | null> {
    this.assertConfigured();
    const query = { symbol, productType: this.productType, startTime: String(sinceMs), limit: '50' };
    const data = await withRetry(
      () =>
        this.request<{
          list: Array<{ symbol: string; holdSide: 'long' | 'short'; closeAvgPrice: string; netProfit: string; utime: string }> | null;
        } | null>('GET', '/api/v2/mix/position/history-position', query),
      { label: `getClosedLong(${symbol})`, logger: this.logger, isRetryable: isNetworkError },
    );
    const list = data?.list ?? [];
    const match = list
      .filter((p) => p.symbol === symbol && p.holdSide === 'long' && Number(p.utime) >= sinceMs)
      .sort((a, b) => Number(b.utime) - Number(a.utime))[0];
    if (!match) return null;
    return { closeAvgPrice: Number(match.closeAvgPrice), netProfit: Number(match.netProfit), closedAtMs: Number(match.utime) };
  }

  // --- internals ---------------------------------------------------------

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error('LongSignalTradeService called without Bitget credentials.');
    }
  }

  private async request<T>(
    method: Extract<Method, 'GET' | 'POST'>,
    path: string,
    query?: Record<string, string>,
    body?: Record<string, string>,
    signed = true,
  ): Promise<T> {
    const timestamp = Date.now().toString();
    const queryString = query
      ? new URLSearchParams(Object.keys(query).sort().map((k) => [k, query[k]] as [string, string])).toString()
      : '';
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const bodyString = body ? JSON.stringify(body) : '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json', locale: 'en-US' };
    if (signed) {
      const prehash = timestamp + method + requestPath + bodyString;
      const sign = createHmac('sha256', this.apiSecret).update(prehash).digest('base64');
      headers['ACCESS-KEY'] = this.apiKey;
      headers['ACCESS-SIGN'] = sign;
      headers['ACCESS-TIMESTAMP'] = timestamp;
      headers['ACCESS-PASSPHRASE'] = this.passphrase;
    }

    const response = await this.client.request<BitgetEnvelope<T>>({
      method,
      url: requestPath,
      data: method === 'POST' ? bodyString : undefined,
      headers,
      validateStatus: () => true,
    });

    const env = response.data as unknown as Partial<BitgetEnvelope<T>> | string | undefined;
    if (!env || typeof env !== 'object' || typeof env.code !== 'string') {
      const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
      throw new BitgetApiError(`http_${response.status}`, path, `Bitget ${path} HTTP ${response.status}: ${raw.slice(0, 300)}`);
    }
    if (env.code !== '00000') {
      throw new BitgetApiError(env.code, path, `Bitget ${path} error ${env.code}: ${env.msg}`);
    }
    return env.data as T;
  }

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

function isNetworkError(err: unknown): boolean {
  if (err instanceof BitgetApiError) return err.code.startsWith('http_5');
  if (axios.isAxiosError(err)) return !err.response || err.response.status >= 500;
  return false;
}
