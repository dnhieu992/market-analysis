import { createHmac } from 'node:crypto';
import axios, { type AxiosInstance, type Method } from 'axios';

/**
 * Minimal authenticated Bitget v2 mix client for the API — only what the manual
 * force-close needs: read the open position and flash-close it at market. The
 * worker has the full trading client (`apps/worker/.../bitget-trade.service.ts`);
 * this is a deliberately small, scoped copy so the API can close a REAL LIVE
 * position without depending on the worker process. Keep the signing in sync
 * with the worker version if Bitget ever changes it.
 */

const BASE_URL = 'https://api.bitget.com';
const MARGIN_COIN = 'USDT';

type BitgetEnvelope<T> = { code: string; msg: string; data: T };

/** Raw shape of one row from `/api/v2/mix/position/all-position` (only fields we read). */
export type BitgetRawPosition = {
  symbol: string;
  marginCoin: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  total: string;
  available: string;
  leverage: string;
  openPriceAvg: string;
  markPrice: string;
  liquidationPrice: string;
  breakEvenPrice: string;
  marginSize: string;
  unrealizedPL: string;
  achievedProfits: string;
  cTime: string;
  uTime: string;
};

/** Contract precision + minimums read from `/api/v2/mix/market/contracts`. */
export type BitgetContractSpec = {
  /** Decimal places allowed for order size (base asset). */
  volumePlace: number;
  /** Decimal places allowed for price. */
  pricePlace: number;
  /** Minimum order size in base asset. */
  minTradeNum: number;
  /** Size must be a whole multiple of this step. */
  sizeMultiplier: number;
};

export class BitgetTradeClient {
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 8_000 });
  private readonly apiKey = process.env.BITGET_API_KEY ?? '';
  private readonly apiSecret = process.env.BITGET_API_SECRET ?? '';
  private readonly passphrase = process.env.BITGET_API_PASSPHRASE ?? '';
  private readonly productType = process.env.BITGET_PRODUCT_TYPE ?? 'usdt-futures';
  // Bitget account position mode. In hedge_mode place-order REQUIRES `tradeSide`
  // ('open'/'close') alongside `side`; one_way_mode must omit it. Defaults to
  // hedge to match the LIVE account (kept in sync with the worker trade client).
  private readonly hedgeMode = (process.env.BITGET_POSITION_MODE ?? 'hedge') !== 'one-way';

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.passphrase);
  }

  /** Current last-traded price for a symbol (public market data). */
  async getTickerPrice(symbol: string): Promise<number> {
    const data = await this.request<Array<{ symbol: string; lastPr: string }>>(
      'GET',
      '/api/v2/mix/market/ticker',
      { symbol, productType: this.productType },
    );
    const row = (data ?? []).find((t) => t.symbol === symbol) ?? data?.[0];
    const price = row ? Number(row.lastPr) : NaN;
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`No live price for ${symbol}`);
    }
    return price;
  }

  /** Contract precision/minimums for a symbol (public market data). */
  async getContractSpec(symbol: string): Promise<BitgetContractSpec> {
    const data = await this.request<
      Array<{
        symbol: string;
        volumePlace: string;
        pricePlace: string;
        minTradeNum: string;
        sizeMultiplier: string;
      }>
    >('GET', '/api/v2/mix/market/contracts', { symbol, productType: this.productType });
    const row = (data ?? []).find((c) => c.symbol === symbol) ?? data?.[0];
    if (!row) throw new Error(`No contract spec for ${symbol}`);
    return {
      volumePlace: Number(row.volumePlace),
      pricePlace: Number(row.pricePlace),
      minTradeNum: Number(row.minTradeNum),
      sizeMultiplier: Number(row.sizeMultiplier) || Number(row.minTradeNum),
    };
  }

  /**
   * Set leverage for a symbol in CROSS mode (leverage is shared across sides, so
   * no `holdSide` is sent). Called before the first order so margin/liquidation
   * are deterministic rather than inheriting the account default.
   */
  async setCrossLeverage(symbol: string, leverage: number): Promise<void> {
    await this.request<unknown>('POST', '/api/v2/mix/account/set-leverage', undefined, {
      symbol,
      productType: this.productType,
      marginCoin: MARGIN_COIN,
      leverage: String(leverage),
    });
  }

  /** Open a market position in CROSS mode (no preset TP/SL — a manual, naked entry). */
  async openMarketPosition(params: {
    symbol: string;
    holdSide: 'long' | 'short';
    size: string;
    clientOid: string;
  }): Promise<void> {
    const body: Record<string, string> = {
      symbol: params.symbol,
      productType: this.productType,
      marginMode: 'crossed',
      marginCoin: MARGIN_COIN,
      size: params.size,
      side: params.holdSide === 'long' ? 'buy' : 'sell',
      orderType: 'market',
      clientOid: params.clientOid,
    };
    // Hedge mode requires the open/close intent explicitly; one-way mode forbids it.
    if (this.hedgeMode) body.tradeSide = 'open';
    await this.request<unknown>('POST', '/api/v2/mix/order/place-order', undefined, body);
  }

  /** Open size for a side, or 0 if the exchange is flat. */
  async getPositionSize(symbol: string, holdSide: 'long' | 'short'): Promise<number> {
    const data = await this.request<
      Array<{ holdSide: 'long' | 'short'; total: string }>
    >('GET', '/api/v2/mix/position/single-position', {
      symbol,
      productType: this.productType,
      marginCoin: MARGIN_COIN,
    });
    const open = data.find((p) => p.holdSide === holdSide && Number(p.total) > 0);
    return open ? Number(open.total) : 0;
  }

  /**
   * Account balance for the USDT-futures wallet: total equity (incl. unrealized
   * PnL), the USDT-denominated equity, and the free/available balance. Reads the
   * USDT `marginCoin` account row; returns null if the wallet has no USDT row.
   */
  async getAccountBalance(): Promise<{
    accountEquity: number;
    usdtEquity: number;
    available: number;
    unrealizedPL: number;
  } | null> {
    const data = await this.request<
      Array<{
        marginCoin: string;
        accountEquity: string;
        usdtEquity: string;
        available: string;
        unrealizedPL: string;
      }>
    >('GET', '/api/v2/mix/account/accounts', { productType: this.productType });
    const usdt = (data ?? []).find((a) => a.marginCoin === MARGIN_COIN) ?? data?.[0];
    if (!usdt) return null;
    return {
      accountEquity: Number(usdt.accountEquity),
      usdtEquity: Number(usdt.usdtEquity),
      available: Number(usdt.available),
      unrealizedPL: Number(usdt.unrealizedPL),
    };
  }

  /** Every open position across all symbols, or [] if the account is flat. */
  async getAllPositions(): Promise<BitgetRawPosition[]> {
    const data = await this.request<BitgetRawPosition[]>(
      'GET',
      '/api/v2/mix/position/all-position',
      { productType: this.productType, marginCoin: MARGIN_COIN },
    );
    return (data ?? []).filter((p) => Number(p.total) > 0);
  }

  /** Flash-close the open position for a side at market (reduce-only). */
  async closePosition(symbol: string, holdSide: 'long' | 'short'): Promise<void> {
    await this.request<unknown>('POST', '/api/v2/mix/order/close-positions', undefined, {
      symbol,
      productType: this.productType,
      holdSide,
    });
  }

  private async request<T>(
    method: Extract<Method, 'GET' | 'POST'>,
    path: string,
    query?: Record<string, string>,
    body?: Record<string, string>,
  ): Promise<T> {
    const timestamp = Date.now().toString();
    const queryString = query
      ? new URLSearchParams(
          Object.keys(query)
            .sort()
            .map((k) => [k, query[k]] as [string, string]),
        ).toString()
      : '';
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const bodyString = body ? JSON.stringify(body) : '';

    const prehash = timestamp + method + requestPath + bodyString;
    const sign = createHmac('sha256', this.apiSecret).update(prehash).digest('base64');

    const res = await this.client.request<BitgetEnvelope<T>>({
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

    if (res.data.code !== '00000') {
      throw new Error(`Bitget ${path} error ${res.data.code}: ${res.data.msg}`);
    }
    return res.data.data;
  }
}
