import { createHmac } from 'node:crypto';
import axios, { type AxiosInstance } from 'axios';

import type { FillAction, FillSide, FillSource, OrderMeta, PositionSnap, RawFill } from './order-fill.types';

/**
 * Bitget USDT-futures fills for the order-fill watcher. Read-only, own signing (same scheme
 * as BitgetHistoryService) so it never depends on the API process.
 *
 * `fill-history` is keyed by FILL time, so a limit order resting for days is still caught
 * the moment it fills (orders-history is keyed by order creation time and would miss it).
 */

const BASE_URL = 'https://api.bitget.com';
const PRODUCT_TYPE = 'USDT-FUTURES';
const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

type Envelope<T> = { code: string; msg: string; data: T };

type FillRaw = {
  tradeId?: string;
  orderId?: string;
  symbol?: string;
  price?: string;
  baseVolume?: string;
  quoteVolume?: string;
  profit?: string;
  side?: string; // buy | sell
  tradeSide?: string; // open | close | reduce_close_long | burst_close_short | buy_single | …
  feeDetail?: Array<{ totalFee?: string }> | null;
  cTime?: string;
};

type OrderDetailRaw = { orderType?: string; orderSource?: string; clientOid?: string };

type PositionRaw = { symbol?: string; holdSide?: string; total?: string; openPriceAvg?: string };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Side + action of a Bitget fill. In hedge mode `side` is the position direction (buy = long). */
export function classifyBitgetFill(side: string | undefined, tradeSide: string | undefined): { side: FillSide | null; action: FillAction } {
  const ts = (tradeSide ?? '').toLowerCase();
  let action: FillAction = 'unknown';
  if (ts.includes('burst')) action = 'liquidation';
  else if (ts.includes('close') || ts.startsWith('reduce')) action = 'close';
  else if (ts === 'open') action = 'open';

  let dir: FillSide | null = null;
  if (ts.endsWith('_long')) dir = 'long';
  else if (ts.endsWith('_short')) dir = 'short';
  else if (ts === 'open' || ts === 'close') dir = side === 'buy' ? 'long' : side === 'sell' ? 'short' : null;
  return { side: dir, action };
}

/** TP / SL / liquidation from Bitget's `orderSource` (profit_market, pos_loss_limit, liquidation…). */
export function bitgetOrderKind(orderSource: string | undefined): OrderMeta['kind'] {
  const s = (orderSource ?? '').toLowerCase();
  if (s.includes('liquidation') || s.includes('burst')) return 'liquidation';
  if (s.includes('profit')) return 'tp';
  if (s.includes('loss')) return 'sl';
  return null;
}

export class BitgetFillSource implements FillSource {
  readonly exchange = 'bitget' as const;
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 10_000 });
  private readonly apiKey = process.env.BITGET_API_KEY ?? '';
  private readonly apiSecret = process.env.BITGET_API_SECRET ?? '';
  private readonly passphrase = process.env.BITGET_API_PASSPHRASE ?? '';

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.passphrase);
  }

  async fetchFills(sinceMs: number, untilMs: number): Promise<RawFill[]> {
    const out: RawFill[] = [];
    let idLessThan: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query: Record<string, string> = {
        productType: PRODUCT_TYPE,
        startTime: String(Math.floor(sinceMs)),
        endTime: String(Math.floor(untilMs)),
        limit: String(PAGE_LIMIT),
      };
      if (idLessThan) query.idLessThan = idLessThan;
      const env = await this.signedGet<Envelope<{ fillList: FillRaw[] | null; endId?: string } | null>>(
        '/api/v2/mix/order/fill-history',
        query,
      );
      const list = env.data?.fillList ?? [];
      for (const f of list) {
        if (!f.tradeId || !f.orderId || !f.symbol) continue;
        const { side, action } = classifyBitgetFill(f.side, f.tradeSide);
        const size = num(f.baseVolume);
        const price = num(f.price);
        out.push({
          id: f.tradeId,
          orderId: f.orderId,
          symbol: f.symbol.toUpperCase(),
          side,
          action,
          price,
          size,
          quote: num(f.quoteVolume) || size * price,
          profit: num(f.profit),
          fee: (f.feeDetail ?? []).reduce((s, d) => s + num(d.totalFee), 0),
          ts: num(f.cTime),
        });
      }
      if (list.length < PAGE_LIMIT || !env.data?.endId) break;
      idLessThan = env.data.endId;
    }
    return out;
  }

  async fetchOrderMeta(symbol: string, orderId: string): Promise<OrderMeta | null> {
    const env = await this.signedGet<Envelope<OrderDetailRaw | null>>('/api/v2/mix/order/detail', {
      productType: PRODUCT_TYPE,
      symbol,
      orderId,
    });
    const d = env.data;
    if (!d) return null;
    return {
      orderType: d.orderType ?? null,
      source: d.orderSource ?? null,
      kind: bitgetOrderKind(d.orderSource),
      clientOid: d.clientOid ?? null,
    };
  }

  async fetchPositions(): Promise<PositionSnap[] | null> {
    try {
      const env = await this.signedGet<Envelope<PositionRaw[] | null>>('/api/v2/mix/position/all-position', {
        productType: PRODUCT_TYPE,
        marginCoin: 'USDT',
      });
      return (env.data ?? [])
        .filter((p) => p.symbol && (p.holdSide === 'long' || p.holdSide === 'short') && num(p.total) > 0)
        .map((p) => ({
          symbol: p.symbol!.toUpperCase(),
          side: p.holdSide as FillSide,
          size: num(p.total),
          avgPrice: num(p.openPriceAvg),
        }));
    } catch {
      return null;
    }
  }

  private async signedGet<E extends { code: string; msg: string }>(path: string, query: Record<string, string>): Promise<E> {
    const timestamp = Date.now().toString();
    const queryString = new URLSearchParams(
      Object.keys(query)
        .sort()
        .map((k) => [k, query[k]] as [string, string]),
    ).toString();
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const sign = createHmac('sha256', this.apiSecret).update(`${timestamp}GET${requestPath}`).digest('base64');
    const res = await this.client.get<E>(requestPath, {
      headers: {
        'ACCESS-KEY': this.apiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': this.passphrase,
        'Content-Type': 'application/json',
        locale: 'en-US',
      },
    });
    if (res.data.code !== '00000') throw new Error(`Bitget ${path} error ${res.data.code}: ${res.data.msg}`);
    return res.data;
  }
}
