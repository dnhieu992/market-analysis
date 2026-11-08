import { createHmac } from 'node:crypto';
import axios, { type AxiosInstance } from 'axios';

import type { FillAction, FillSide, FillSource, OrderMeta, PositionSnap, RawFill } from './order-fill.types';

/**
 * MEXC USDT-futures fills for the order-fill watcher. Read-only, own signing (same scheme as
 * MexcHistoryService). `order/list/order_deals` (no symbol = every symbol) is keyed by fill
 * time. Volumes are CONTRACTS → converted with the cached public `contractSize`.
 */

const BASE_URL = process.env.MEXC_API_BASE_URL ?? 'https://api.mexc.com';
const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

type Envelope<T> = { success?: boolean; code?: number; message?: string; data: T };

type DealRaw = {
  id?: string | number;
  orderId?: string | number;
  symbol?: string; // BTC_USDT
  side?: number; // 1 open long · 2 close short · 3 open short · 4 close long
  vol?: number;
  price?: number;
  fee?: number; // positive = paid
  profit?: number;
  timestamp?: number;
};

type OrderRaw = { orderType?: number; category?: number; externalOid?: string };

type PositionRaw = { symbol?: string; positionType?: number; holdVol?: number; holdAvgPrice?: number };

/** MEXC orderType codes (display only). */
const ORDER_TYPE: Record<number, string> = { 1: 'limit', 2: 'post-only', 3: 'ioc', 4: 'fok', 5: 'market', 6: 'market' };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function fromMexcSymbol(s: string): string {
  return s.replace('_', '').toUpperCase();
}

function toMexcSymbol(s: string): string {
  return s.endsWith('USDT') && !s.includes('_') ? `${s.slice(0, -4)}_USDT` : s;
}

export function classifyMexcDeal(side: number | undefined): { side: FillSide | null; action: FillAction } {
  switch (side) {
    case 1:
      return { side: 'long', action: 'open' };
    case 2:
      return { side: 'short', action: 'close' };
    case 3:
      return { side: 'short', action: 'open' };
    case 4:
      return { side: 'long', action: 'close' };
    default:
      return { side: null, action: 'unknown' };
  }
}

export class MexcFillSource implements FillSource {
  readonly exchange = 'mexc' as const;
  private readonly client: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 10_000 });
  private readonly apiKey = process.env.MEXC_API_KEY ?? '';
  private readonly apiSecret = process.env.MEXC_API_SECRET ?? '';
  private readonly contractSizes = new Map<string, number>();

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  async fetchFills(sinceMs: number, untilMs: number): Promise<RawFill[]> {
    const deals: DealRaw[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const env = await this.signedGet<Envelope<DealRaw[] | null>>('/api/v1/private/order/list/order_deals', {
        page_num: String(page),
        page_size: String(PAGE_LIMIT),
        start_time: String(Math.floor(sinceMs)),
        end_time: String(Math.floor(untilMs)),
      });
      const list = Array.isArray(env.data) ? env.data : [];
      deals.push(...list);
      if (list.length < PAGE_LIMIT) break;
    }

    const out: RawFill[] = [];
    for (const d of deals) {
      if (d.id == null || d.orderId == null || !d.symbol) continue;
      const symbol = fromMexcSymbol(d.symbol);
      const cs = await this.contractSizeOf(symbol);
      const { side, action } = classifyMexcDeal(d.side);
      const price = num(d.price);
      const size = num(d.vol) * cs;
      out.push({
        id: String(d.id),
        orderId: String(d.orderId),
        symbol,
        side,
        action,
        price,
        size,
        quote: size * price,
        profit: num(d.profit),
        fee: -Math.abs(num(d.fee)),
        ts: num(d.timestamp),
      });
    }
    return out;
  }

  async fetchOrderMeta(_symbol: string, orderId: string): Promise<OrderMeta | null> {
    const env = await this.signedGet<Envelope<OrderRaw | null>>(`/api/v1/private/order/get/${encodeURIComponent(orderId)}`, {});
    const o = env.data;
    if (!o) return null;
    return {
      orderType: o.orderType != null ? (ORDER_TYPE[o.orderType] ?? null) : null,
      source: o.category != null ? `category:${o.category}` : null,
      // category 2 = system take-over (liquidation), 4 = ADL reduction.
      kind: o.category === 2 ? 'liquidation' : null,
      clientOid: o.externalOid ?? null,
    };
  }

  async fetchPositions(): Promise<PositionSnap[] | null> {
    try {
      const env = await this.signedGet<Envelope<PositionRaw[] | null>>('/api/v1/private/position/open_positions', {});
      const out: PositionSnap[] = [];
      for (const p of env.data ?? []) {
        if (!p.symbol || num(p.holdVol) <= 0) continue;
        const symbol = fromMexcSymbol(p.symbol);
        out.push({
          symbol,
          side: p.positionType === 2 ? 'short' : 'long',
          size: num(p.holdVol) * (await this.contractSizeOf(symbol)),
          avgPrice: num(p.holdAvgPrice),
        });
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Base asset per contract (public endpoint, cached). Falls back to 1. */
  private async contractSizeOf(symbol: string): Promise<number> {
    const cached = this.contractSizes.get(symbol);
    if (cached != null) return cached;
    try {
      const res = await this.client.get<{ data: { contractSize?: number } | Array<{ contractSize?: number }> }>(
        '/api/v1/contract/detail',
        { params: { symbol: toMexcSymbol(symbol) } },
      );
      const row = Array.isArray(res.data.data) ? res.data.data[0] : res.data.data;
      const size = Number(row?.contractSize);
      if (Number.isFinite(size) && size > 0) {
        this.contractSizes.set(symbol, size);
        return size;
      }
    } catch {
      /* fall through */
    }
    return 1;
  }

  private async signedGet<E extends { success?: boolean; code?: number; message?: string }>(
    path: string,
    query: Record<string, string>,
  ): Promise<E> {
    const timestamp = Date.now().toString();
    const queryString = Object.keys(query)
      .sort()
      .map((k) => `${k}=${query[k]}`)
      .join('&');
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const sign = createHmac('sha256', this.apiSecret).update(this.apiKey + timestamp + queryString).digest('hex');
    const res = await this.client.get<E>(requestPath, {
      headers: {
        ApiKey: this.apiKey,
        'Request-Time': timestamp,
        Signature: sign,
        'Recv-Window': '30',
        'Content-Type': 'application/json',
      },
    });
    if (res.data.success === false || (res.data.code != null && res.data.code !== 0)) {
      throw new Error(`MEXC ${path} error ${res.data.code}: ${res.data.message ?? 'unknown error'}`);
    }
    return res.data;
  }
}
