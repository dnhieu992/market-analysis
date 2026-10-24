import { calculateEma, calculateRsi, isSupertrendBullish, type Candle } from '@app/core';
import { createTrackingCoinsRepository, createTrackingSetupRepository, TRACKING_ACTIVE_STATUSES } from '@app/db';

import type { ChatTool } from '../contracts/chat-tool';

const BASE = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';
const BARS = 210; // enough for EMA200
const CONCURRENCY = 10;
const CACHE_MS = 60_000;

type KlineRow = [number, string, string, string, string, string, number, ...unknown[]];
type Ticker = { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string };

const pairOf = (symbol: string) => {
  const s = symbol.toUpperCase().trim();
  return s.endsWith('USDT') ? s : `${s}USDT`;
};

async function fetchCandles(pair: string, interval: string): Promise<Candle[]> {
  const res = await fetch(`${BASE}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${BARS}`);
  if (!res.ok) throw new Error(`Binance ${res.status} ${pair} ${interval}`);
  return ((await res.json()) as KlineRow[]).map((r) => ({
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5]),
  }));
}

/** 24h tickers; one batch call, or one call per pair when Binance rejects the batch for an unknown symbol. */
async function fetchTickers(pairs: string[]): Promise<Map<string, Ticker>> {
  const out = new Map<string, Ticker>();
  const res = await fetch(`${BASE}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(pairs))}`).catch(() => null);
  if (res?.ok) {
    for (const t of (await res.json()) as Ticker[]) out.set(t.symbol, t);
    return out;
  }
  await Promise.all(
    pairs.map(async (p) => {
      const r = await fetch(`${BASE}/api/v3/ticker/24hr?symbol=${p}`).catch(() => null);
      if (r?.ok) out.set(p, (await r.json()) as Ticker);
    }),
  );
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const r1 = (n: number | null) => (n == null || !Number.isFinite(n) ? '' : String(Math.round(n * 10) / 10));
const pct = (now: number, then: number | undefined) => (then && then > 0 ? ((now - then) / then) * 100 : null);

/** Trend from closed candles: price vs EMA34/89/200, RSI14, and an EMA-stack label. */
function frame(candles: Candle[]) {
  const closed = candles.slice(0, -1); // the last candle is still forming
  const closes = closed.map((c) => c.close);
  const last = closes[closes.length - 1] ?? NaN;
  const e34 = calculateEma(closes, 34);
  const e89 = calculateEma(closes, 89);
  const e200 = closes.length > 200 ? calculateEma(closes, 200) : null;
  const yn = (e: number | null) => (e == null ? '-' : last > e ? 'Y' : 'N');
  const trend = last > e34 && e34 > e89 ? 'Up' : last < e34 && e34 < e89 ? 'Down' : 'Mixed';
  return { closed, closes, trend, rsi: calculateRsi(closes, 14), ema: `${yn(e34)}${yn(e89)}${yn(e200)}` };
}

async function coinRow(pair: string, name: string, ticker: Ticker | undefined): Promise<string> {
  try {
    const [d1, h4] = await Promise.all([fetchCandles(pair, '1d'), fetchCandles(pair, '4h')]);
    const d = frame(d1);
    const h = frame(h4);
    const price = ticker ? Number(ticker.lastPrice) : d1[d1.length - 1]!.close;
    const c = d.closes;
    const low20 = Math.min(...d.closed.slice(-20).map((x) => x.low));
    const high90 = Math.max(...d.closed.slice(-90).map((x) => x.high));
    // Same rule as the Score column on /tracking-coins (needs 60 closed days).
    const st = d.closed.length >= 60 ? (isSupertrendBullish(d.closed, 10, 3) ? 'Bull' : 'Bear') : '';
    return [
      pair,
      name.replace(/,/g, ' '),
      Number(price.toPrecision(6)),
      ticker ? r1(Number(ticker.priceChangePercent)) : '',
      r1(pct(price, c[c.length - 7])),
      r1(pct(price, c[c.length - 30])),
      r1(pct(price, c[c.length - 90])),
      ticker ? r1(Number(ticker.quoteVolume) / 1e6) : '',
      st,
      d.trend,
      r1(d.rsi),
      d.ema,
      h.trend,
      r1(h.rsi),
      h.ema,
      r1(pct(price, low20)),
      r1(pct(price, high90)),
    ].join(',');
  } catch {
    return `${pair},${name.replace(/,/g, ' ')},không lấy được dữ liệu Binance`;
  }
}

// Several skills may read the list within one reply — rows computed in the last minute are reused.
let cache: { at: number; rows: Map<string, string> } | null = null;

/**
 * The user's watchlist from /tracking-coins, computed live from Binance daily + 4h candles
 * (the stored scan table is not kept fresh): price, % change, Supertrend D1 (the page's Score),
 * trend / RSI / EMA position on D1 and 4H, distance from the 20-day low and 90-day high.
 */
export const getTrackingCoinsTool: ChatTool<{ symbols?: string[] | string; [key: string]: unknown }, string> = {
  name: 'get_tracking_coins',
  description:
    "Get the user's watchlist (the coins on their Tracking Coins page), computed live from Binance: price, 24h/7d/30d/90d " +
    'change, 24h volume, Supertrend(10,3) D1, trend + RSI14 + price vs EMA34/89/200 on 1D and 4H, distance from the ' +
    '20-day low and 90-day high. Use it when the user asks about "my coins", "the list", which coin to trade, or to ' +
    'shortlist coins before fetching detailed candles for a few of them (at most 3). Optionally pass symbols to get only those.',
  inputSchema: {
    type: 'object',
    properties: {
      symbols: { type: 'array', items: { type: 'string' }, description: 'Optional filter, e.g. ["BTC","SOLUSDT"]. Omit for the whole list.' },
    },
  },
  async execute(input) {
    const raw = input?.symbols ?? [];
    const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/);
    const want = new Set(list.filter(Boolean).map((s) => pairOf(String(s))));

    // Same order as the page: market cap first, then when the coin was added.
    const coins = (await createTrackingCoinsRepository().findAllCoins())
      .sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1))
      .map((c) => ({ pair: pairOf(c.symbol), name: c.name || c.symbol }))
      .filter((c) => want.size === 0 || want.has(c.pair));
    if (coins.length === 0) {
      return want.size ? `Không có coin nào trong danh sách theo dõi khớp ${[...want].join(', ')}.` : 'Danh sách theo dõi đang trống.';
    }

    if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), rows: new Map() };
    const rows = cache.rows;
    const missing = coins.filter((c) => !rows.has(c.pair));
    if (missing.length > 0) {
      const tickers = await fetchTickers(missing.map((c) => c.pair));
      const computed = await mapLimit(missing, CONCURRENCY, (c) => coinRow(c.pair, c.name, tickers.get(c.pair)));
      missing.forEach((c, i) => rows.set(c.pair, computed[i]!));
    }

    // Setups alive on the /tracking-coins page (read-only here), so suggestions don't clash with them.
    const active = await createTrackingSetupRepository().list({ statuses: TRACKING_ACTIVE_STATUSES }, 1000);
    const setupsOf = (pair: string) =>
      active
        .filter((x) => pairOf(x.symbol) === pair)
        .map((x) => `${x.status} ${x.direction} @${Number(x.entryPrice.toPrecision(6))}`)
        .join(' | ');

    return [
      `Watchlist (${coins.length} coin), tính trực tiếp từ nến Binance lúc ${new Date().toISOString().slice(0, 16)}Z.`,
      'ema = giá trên(Y)/dưới(N) EMA34,EMA89,EMA200. trend: Up = giá>EMA34>EMA89, Down = giá<EMA34<EMA89, Mixed = lẫn lộn. ' +
        'supertrendD1 = cột Score trên trang Tracking Coins. vs20dLow% / vs90dHigh% = cách đáy 20 ngày / đỉnh 90 ngày. ' +
        'activeSetups = setup paper trên trang Tracking Coins (PROPOSED/WATCHING/PENDING/OPEN), chỉ đọc — đừng đề xuất trùng hay ngược chiều mà không nói rõ.',
      'pair,name,price,chg24h%,chg7d%,chg30d%,chg90d%,vol24hM,supertrendD1,trendD,rsiD,emaD,trend4h,rsi4h,ema4h,vs20dLow%,vs90dHigh%,activeSetups',
      ...coins.map((c) => `${rows.get(c.pair)!},${setupsOf(c.pair)}`),
    ].join('\n');
  },
};
