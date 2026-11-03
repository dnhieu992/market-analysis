import type { ChatTool } from '../contracts/chat-tool';

/**
 * Scanner for the "short coin rác" skill: Binance-listed (spot + USDT-M perp) small caps,
 * flagged against the two setups that held up in the 2026-11-03 study
 * (claude-backtest/runs/2026-11-03-junk-short-patterns.md):
 *   A. pump-fade  — 3-day close-to-close ≥ +50% on the last CLOSED D1 candle
 *   B. EMA bounce — D1 downtrend, red candle wicks into EMA20 but closes under EMA50
 * Rules mirror the study exactly — change them there first.
 */

const FAPI = process.env.BINANCE_FAPI_BASE_URL ?? 'https://fapi.binance.com';
const PRODUCTS_URL = 'https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=false';

const DAY_MS = 86_400_000;
const CACHE_MS = 5 * 60_000;
const KLINE_LIMIT = 200; // enough history for EMA50 to settle
const CONCURRENCY = 8;

const PUMP_A = 0.5;
const PUMP_WATCH = 0.3;

type Product = { s: string; b: string; q: string; st: string; c: string; cs: number | null; tags: string[] | null };
type PerpSymbol = { symbol: string; baseAsset: string; quoteAsset: string; contractType: string; status: string; onboardDate: number };
type PremiumIndex = { symbol: string; lastFundingRate: string };
type Ticker24h = { symbol: string; priceChangePercent: string; lastPrice: string; quoteVolume: string };
type Bar = { t: number; o: number; h: number; l: number; c: number; qv: number };

type ScanInput = { maxMarketCapUsd?: number; minListingDays?: number };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Binance ${res.status} for ${url.split('?')[0]}`);
  return res.json() as Promise<T>;
}

async function dailyBars(symbol: string): Promise<Bar[]> {
  const rows = await getJson<unknown[][]>(`${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${KLINE_LIMIT}`);
  return rows.map((r) => ({ t: Number(r[0]), o: +String(r[1]), h: +String(r[2]), l: +String(r[3]), c: +String(r[4]), qv: +String(r[7]) }));
}

/** Index access that the caller has already bounds-checked (noUncheckedIndexedAccess). */
const at = <T>(xs: readonly T[], i: number): T => xs[i < 0 ? xs.length + i : i] as T;

function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (const v of values) {
    prev = out.length === 0 ? v : prev + k * (v - prev);
    out.push(prev);
  }
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(at(items, i));
      }
    })
  );
  return out;
}

const round = (x: number, d = 4) => Number(x.toPrecision(d));
const pct = (x: number) => Math.round(x * 1000) / 10; // 0.523 → 52.3

let cache: { key: string; at: number; result: string } | null = null;

async function scan(maxMc: number, minDays: number): Promise<string> {
  const now = Date.now();
  const [products, info, premium, tickers] = await Promise.all([
    getJson<{ data: Product[] }>(PRODUCTS_URL),
    getJson<{ symbols: PerpSymbol[] }>(`${FAPI}/fapi/v1/exchangeInfo`),
    getJson<PremiumIndex[]>(`${FAPI}/fapi/v1/premiumIndex`),
    getJson<Ticker24h[]>(`${FAPI}/fapi/v1/ticker/24hr`)
  ]);

  const spot = new Map(products.data.filter((p) => p.q === 'USDT' && p.st === 'TRADING').map((p) => [p.b, p]));
  const funding = new Map(premium.map((p) => [p.symbol, Number(p.lastFundingRate)]));
  const t24 = new Map(tickers.map((t) => [t.symbol, t]));

  const universe = info.symbols
    .filter((s) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING' && spot.has(s.baseAsset))
    .map((s) => {
      const p = spot.get(s.baseAsset)!;
      return { perp: s, mc: (p.cs ?? 0) * Number(p.c), tags: p.tags ?? [] };
    })
    .filter((u) => u.mc > 0 && u.mc <= maxMc);

  const tooNew = universe.filter((u) => (now - u.perp.onboardDate) / DAY_MS < minDays);
  const eligible = universe.filter((u) => (now - u.perp.onboardDate) / DAY_MS >= minDays);

  // BTC regime — the single biggest filter in the study (win 86% vs 67% on setup A).
  const btc = await dailyBars('BTCUSDT');
  const btcClosed = btc.slice(0, -1);
  const btcEma50 = ema(btcClosed.map((b) => b.c), 50);
  if (btcClosed.length < 51) throw new Error('not enough BTC history');
  const btcLast = at(btcClosed, -1);
  const btcEma50Last = at(btcEma50, -1);
  const btcBear = btcLast.c < btcEma50Last;

  const rows = await mapLimit(eligible, CONCURRENCY, async (u) => {
    let bars: Bar[];
    try {
      bars = await dailyBars(u.perp.symbol);
    } catch {
      return null;
    }
    const closed = bars.slice(0, -1); // last bar is today's, still forming
    const i = closed.length - 1;
    if (i < 60) return null;
    const C = closed.map((b) => b.c);
    const e20 = ema(C, 20);
    const e50 = ema(C, 50);
    const c = (j: number) => at(C, j);
    const sig = at(closed, i);
    const pump3d = c(i) / c(i - 3) - 1;
    const avgVol20 = closed.slice(i - 20, i).reduce((s, b) => s + b.qv, 0) / 20;
    const today = at(bars, -1);
    const tk = t24.get(u.perp.symbol);
    const price = tk ? Number(tk.lastPrice) : today.c;

    const setupA = pump3d >= PUMP_A;
    const watchA = !setupA && pump3d >= PUMP_WATCH;
    const setupB =
      at(e20, i) < at(e50, i) &&
      at(e50, i) < at(e50, i - 10) &&
      c(i - 5) < at(e20, i - 5) &&
      sig.h >= at(e20, i) &&
      c(i) < at(e50, i) &&
      sig.c < sig.o;
    if (!setupA && !watchA && !setupB) return null;

    const pumpTop = Math.max(...closed.slice(i - 6).map((b) => b.h), today.h);
    const fr = funding.get(u.perp.symbol) ?? 0;
    const ladder = setupA
      ? { adds: [price, price * 1.3, price * 1.6], hardStop: price * 2, tpFromAvg: -0.2, timeStopDays: 30 }
      : { adds: [price, price * 1.15, price * 1.3], hardStop: price * 1.5, tpFromAvg: -0.1, timeStopDays: 20 };

    return {
      symbol: u.perp.symbol,
      setup: setupA ? 'A_PUMP_FADE' : setupB ? 'B_EMA_BOUNCE' : 'WATCH_PUMP',
      marketCapUsdM: round(u.mc / 1e6, 3),
      monitoringTag: u.tags.includes('Monitoring'),
      listingDays: Math.floor((now - u.perp.onboardDate) / DAY_MS),
      pump3dPct: pct(pump3d),
      signalDayChangePct: pct(sig.c / c(i - 1) - 1),
      volumeX20d: round(sig.qv / (avgVol20 || 1), 3),
      price: round(price, 6),
      todayFromOpenPct: pct(price / today.o - 1),
      pumpTop: round(pumpTop, 6),
      ema20: round(at(e20, i), 6),
      ema50: round(at(e50, i), 6),
      fundingPct: round(fr * 100, 3),
      change24hPct: tk ? Number(tk.priceChangePercent) : null,
      plan: {
        entries: ladder.adds.map((x) => round(x, 6)),
        hardStop: round(ladder.hardStop, 6),
        takeProfit: `avg entry ${ladder.tpFromAvg * 100}%`,
        timeStopDays: ladder.timeStopDays
      }
    };
  });

  const found = rows.filter((r): r is NonNullable<typeof r> => r != null);
  const order = { A_PUMP_FADE: 0, B_EMA_BOUNCE: 1, WATCH_PUMP: 2 } as const;
  found.sort((a, b) => order[a.setup as keyof typeof order] - order[b.setup as keyof typeof order] || b.pump3dPct - a.pump3dPct);

  // Today's intraday movers among eligible coins: a +50% day-in-progress becomes tomorrow's setup A.
  const movers = eligible
    .map((u) => ({ symbol: u.perp.symbol, change24hPct: Number(t24.get(u.perp.symbol)?.priceChangePercent ?? 0) }))
    .filter((m) => m.change24hPct >= 25)
    .sort((a, b) => b.change24hPct - a.change24hPct)
    .slice(0, 10);

  return JSON.stringify({
    scannedAt: new Date(now).toISOString(),
    filters: { maxMarketCapUsdM: maxMc / 1e6, minListingDays: minDays, signalCandle: 'last CLOSED D1 (UTC 00:00)' },
    btc: { close: round(btcLast.c, 6), ema50D1: round(btcEma50Last, 6), bear: btcBear },
    universe: { smallCaps: universe.length, eligible: eligible.length, excludedTooNew: tooNew.map((u) => u.perp.symbol) },
    candidates: found,
    intradayMovers: movers
  });
}

export const scanJunkShortsTool: ChatTool<ScanInput, string> = {
  name: 'scan_junk_shorts',
  description:
    'Scan every coin listed on BOTH Binance spot and Binance USDT-M perpetual futures with a small market cap ' +
    '(default ≤ $100M, circulating supply × price) for short setups from the junk-coin study: ' +
    'A_PUMP_FADE (3-day close-to-close ≥ +50% on the last closed D1 candle), WATCH_PUMP (+30–50%), ' +
    'B_EMA_BOUNCE (D1 downtrend, red candle wicked into EMA20 and closed under EMA50). ' +
    'Also returns the BTC D1 regime (close vs EMA50), funding rate, Binance Monitoring tag, listing age, ' +
    'a ladder plan per candidate, and today\'s +25% intraday movers. Coins listed < minListingDays are excluded.',
  inputSchema: {
    type: 'object',
    properties: {
      maxMarketCapUsd: { type: 'number', description: 'Market-cap ceiling in USD (default 100000000)' },
      minListingDays: { type: 'number', description: 'Minimum days since the futures listing (default 90)' }
    }
  },
  async execute(input) {
    const maxMc = input?.maxMarketCapUsd && input.maxMarketCapUsd > 0 ? input.maxMarketCapUsd : 100e6;
    const minDays = input?.minListingDays != null && input.minListingDays >= 0 ? input.minListingDays : 90;
    const key = `${maxMc}:${minDays}`;
    if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.result;
    try {
      const result = await scan(maxMc, minDays);
      cache = { key, at: Date.now(), result };
      return result;
    } catch (err) {
      return JSON.stringify({ error: `scan_junk_shorts failed: ${(err as Error).message}` });
    }
  }
};
