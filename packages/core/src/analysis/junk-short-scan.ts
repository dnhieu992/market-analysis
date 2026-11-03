/**
 * "Short coin rác" scanner — shared by the API chat tool (`scan_junk_shorts`) and the
 * worker Telegram alert. Universe: coins listed on BOTH Binance spot (USDT) and Binance
 * USDT-M perpetuals, small market cap, futures listed long enough. Setups come from the
 * 2026-11-03 study (claude-backtest/runs/2026-11-03-junk-short-patterns.md):
 *   A. pump fade  — 3-day close-to-close ≥ +50% on the last CLOSED D1 candle
 *   B. EMA bounce — D1 downtrend, red candle wicks into EMA20 but closes under EMA50
 * Also returns Binance's top 24h gainers, since junk coins live there.
 * Change the rules in the study first, then here.
 */

export type JunkBar = { t: number; o: number; h: number; l: number; c: number; qv: number };

export type JunkSetup = 'A_PUMP_FADE' | 'B_EMA_BOUNCE' | 'WATCH_PUMP';

export type JunkLadderPlan = {
  entries: number[];
  hardStop: number;
  takeProfit: string;
  timeStopDays: number;
};

export type JunkCandidate = {
  symbol: string;
  setup: JunkSetup;
  marketCapUsdM: number;
  monitoringTag: boolean;
  listingDays: number;
  pump3dPct: number;
  signalDate: string;
  signalDayChangePct: number;
  volumeX20d: number;
  price: number;
  todayFromOpenPct: number;
  pumpTop: number;
  ema20: number;
  ema50: number;
  fundingPct: number;
  change24hPct: number | null;
  plan: JunkLadderPlan;
};

export type JunkTopGainer = {
  rank: number;
  symbol: string;
  change24hPct: number;
  quoteVolume24hUsdM: number;
  price: number;
  fundingPct: number;
  spotListed: boolean;
  marketCapUsdM: number | null;
  listingDays: number;
  monitoringTag: boolean;
  /** Passes the junk-short universe (spot + perp, cap, listing age). */
  junk: boolean;
  notJunkReason: string | null;
  /** 3-day pump if today's D1 candle closed at the current price — ≥ 50 means setup A tomorrow. */
  pump3dIfClosedNowPct: number | null;
  /** Setup already printed on the last closed candle, if any. */
  setup: JunkSetup | null;
};

export type JunkShortScan = {
  scannedAt: string;
  filters: { maxMarketCapUsdM: number; minListingDays: number; signalCandle: string };
  btc: { close: number; ema50D1: number; bear: boolean };
  universe: { smallCaps: number; eligible: number; excludedTooNew: string[] };
  candidates: JunkCandidate[];
  topGainers: JunkTopGainer[];
  topGainersSummary: { count: number; junk: number; notOnSpot: number; overCap: number; tooNew: number };
};

export type JunkShortScanOptions = {
  maxMarketCapUsd?: number;
  minListingDays?: number;
  topGainers?: number;
  fapiBaseUrl?: string;
  now?: number;
};

export const JUNK_PUMP_A = 0.5;
export const JUNK_PUMP_WATCH = 0.3;
export const JUNK_DEFAULT_MAX_MC = 100e6;
export const JUNK_DEFAULT_MIN_LISTING_DAYS = 90;

const PRODUCTS_URL = 'https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=false';
const DAY_MS = 86_400_000;
const KLINE_LIMIT = 200; // enough history for EMA50 to settle
const CONCURRENCY = 8;

type Product = { b: string; q: string; st: string; c: string; cs: number | null; tags: string[] | null };
type PerpSymbol = { symbol: string; baseAsset: string; quoteAsset: string; contractType: string; status: string; onboardDate: number };
type PremiumIndex = { symbol: string; lastFundingRate: string };
type Ticker24h = { symbol: string; priceChangePercent: string; lastPrice: string; quoteVolume: string };

/** Index access the caller already bounds-checked (noUncheckedIndexedAccess); negative = from the end. */
const at = <T>(xs: readonly T[], i: number): T => xs[i < 0 ? xs.length + i : i] as T;
const sig4 = (x: number, d = 4) => Number(x.toPrecision(d));
const pct = (x: number) => Math.round(x * 1000) / 10; // 0.523 → 52.3

export function emaSeries(values: readonly number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  let prev = 0;
  for (const v of values) {
    prev = out.length === 0 ? v : prev + k * (v - prev);
    out.push(prev);
  }
  return out;
}

export type JunkSetupEval = {
  setup: JunkSetup | null;
  pump3d: number;
  ema20: number;
  ema50: number;
  volumeX20d: number;
};

/**
 * Evaluate the setups on CLOSED daily bars only (oldest → newest; the last element is the
 * signal candle). Pure — this is what the spec pins against the study's rules.
 */
export function evaluateJunkSetup(closed: readonly JunkBar[]): JunkSetupEval | null {
  const i = closed.length - 1;
  if (i < 60) return null;
  const C = closed.map((b) => b.c);
  const e20 = emaSeries(C, 20);
  const e50 = emaSeries(C, 50);
  const c = (j: number) => at(C, j);
  const sig = at(closed, i);
  const pump3d = c(i) / c(i - 3) - 1;
  const avgVol20 = closed.slice(i - 20, i).reduce((s, b) => s + b.qv, 0) / 20;
  const emaBounce =
    at(e20, i) < at(e50, i) &&
    at(e50, i) < at(e50, i - 10) &&
    c(i - 5) < at(e20, i - 5) &&
    sig.h >= at(e20, i) &&
    c(i) < at(e50, i) &&
    sig.c < sig.o;
  const setup: JunkSetup | null =
    pump3d >= JUNK_PUMP_A ? 'A_PUMP_FADE' : emaBounce ? 'B_EMA_BOUNCE' : pump3d >= JUNK_PUMP_WATCH ? 'WATCH_PUMP' : null;
  return { setup, pump3d, ema20: at(e20, i), ema50: at(e50, i), volumeX20d: sig.qv / (avgVol20 || 1) };
}

/** Ladder from the study: A = 0/+30/+60%, stop +100%, TP avg −20%, 30d · B = 0/+15/+30%, stop +50%, TP −10%, 20d. */
export function junkLadderPlan(setup: JunkSetup, price: number): JunkLadderPlan {
  const a = setup !== 'B_EMA_BOUNCE';
  const steps = a ? [0, 0.3, 0.6] : [0, 0.15, 0.3];
  return {
    entries: steps.map((s) => sig4(price * (1 + s), 6)),
    hardStop: sig4(price * (a ? 2 : 1.5), 6),
    takeProfit: a ? 'avg entry -20%' : 'avg entry -10%',
    timeStopDays: a ? 30 : 20,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Binance ${res.status} for ${url.split('?')[0]}`);
  return res.json() as Promise<T>;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(at(items, i));
      }
    }),
  );
  return out;
}

export async function scanJunkShorts(opts: JunkShortScanOptions = {}): Promise<JunkShortScan> {
  const fapi = opts.fapiBaseUrl ?? 'https://fapi.binance.com';
  const maxMc = opts.maxMarketCapUsd && opts.maxMarketCapUsd > 0 ? opts.maxMarketCapUsd : JUNK_DEFAULT_MAX_MC;
  const minDays = opts.minListingDays != null && opts.minListingDays >= 0 ? opts.minListingDays : JUNK_DEFAULT_MIN_LISTING_DAYS;
  const topN = Math.min(Math.max(opts.topGainers ?? 20, 0), 50);
  const now = opts.now ?? Date.now();

  const dailyBars = async (symbol: string): Promise<JunkBar[]> => {
    const rows = await getJson<unknown[][]>(`${fapi}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${KLINE_LIMIT}`);
    return rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), qv: Number(r[7]) }));
  };

  const [products, info, premium, tickers] = await Promise.all([
    getJson<{ data: Product[] }>(PRODUCTS_URL),
    getJson<{ symbols: PerpSymbol[] }>(`${fapi}/fapi/v1/exchangeInfo`),
    getJson<PremiumIndex[]>(`${fapi}/fapi/v1/premiumIndex`),
    getJson<Ticker24h[]>(`${fapi}/fapi/v1/ticker/24hr`),
  ]);

  const spot = new Map(products.data.filter((p) => p.q === 'USDT' && p.st === 'TRADING').map((p) => [p.b, p]));
  const funding = new Map(premium.map((p) => [p.symbol, Number(p.lastFundingRate)]));
  const t24 = new Map(tickers.map((t) => [t.symbol, t]));

  const perps = info.symbols.filter((s) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING');
  const meta = (s: PerpSymbol) => {
    const p = spot.get(s.baseAsset);
    const mc = p ? (p.cs ?? 0) * Number(p.c) : null;
    const listingDays = Math.floor((now - s.onboardDate) / DAY_MS);
    const notJunkReason = !p
      ? 'not on Binance spot'
      : !mc
        ? 'no market-cap data'
        : mc > maxMc
          ? `market cap > $${maxMc / 1e6}M`
          : listingDays < minDays
            ? `futures listed < ${minDays} days`
            : null;
    return { perp: s, mc, listingDays, tags: p?.tags ?? [], notJunkReason };
  };
  const all = perps.map(meta);
  const smallCaps = all.filter((u) => u.mc != null && u.mc > 0 && u.mc <= maxMc);
  const eligible = all.filter((u) => u.notJunkReason == null);
  const tooNew = smallCaps.filter((u) => u.listingDays < minDays);

  // BTC regime — the single biggest filter in the study (setup A win 86% vs 67%).
  const btcClosed = (await dailyBars('BTCUSDT')).slice(0, -1);
  if (btcClosed.length < 51) throw new Error('not enough BTC history');
  const btcEma50 = at(emaSeries(btcClosed.map((b) => b.c), 50), -1);
  const btcClose = at(btcClosed, -1).c;

  const evaluated = await mapLimit(eligible, CONCURRENCY, async (u) => {
    let bars: JunkBar[];
    try {
      bars = await dailyBars(u.perp.symbol);
    } catch {
      return null;
    }
    const closed = bars.slice(0, -1); // the last bar is today's, still forming
    const ev = evaluateJunkSetup(closed);
    if (!ev) return null;
    const today = at(bars, -1);
    const tk = t24.get(u.perp.symbol);
    const price = tk ? Number(tk.lastPrice) : today.c;
    const pump3dIfClosedNow = closed.length >= 3 ? price / at(closed, -3).c - 1 : null;
    let candidate: JunkCandidate | null = null;
    if (ev.setup) {
      const sig = at(closed, -1);
      candidate = {
        symbol: u.perp.symbol,
        setup: ev.setup,
        marketCapUsdM: sig4((u.mc ?? 0) / 1e6, 3),
        monitoringTag: u.tags.includes('Monitoring'),
        listingDays: u.listingDays,
        pump3dPct: pct(ev.pump3d),
        signalDate: new Date(sig.t).toISOString().slice(0, 10),
        signalDayChangePct: pct(sig.c / at(closed, -2).c - 1),
        volumeX20d: sig4(ev.volumeX20d, 3),
        price: sig4(price, 6),
        todayFromOpenPct: pct(price / today.o - 1),
        pumpTop: sig4(Math.max(...closed.slice(-7).map((b) => b.h), today.h), 6),
        ema20: sig4(ev.ema20, 6),
        ema50: sig4(ev.ema50, 6),
        fundingPct: sig4((funding.get(u.perp.symbol) ?? 0) * 100, 3),
        change24hPct: tk ? Number(tk.priceChangePercent) : null,
        plan: junkLadderPlan(ev.setup, price),
      };
    }
    return { symbol: u.perp.symbol, candidate, pump3dIfClosedNow };
  });
  const bySymbol = new Map(evaluated.filter((e): e is NonNullable<typeof e> => e != null).map((e) => [e.symbol, e]));

  const order: Record<JunkSetup, number> = { A_PUMP_FADE: 0, B_EMA_BOUNCE: 1, WATCH_PUMP: 2 };
  const candidates = [...bySymbol.values()]
    .map((e) => e.candidate)
    .filter((c): c is JunkCandidate => c != null)
    .sort((a, b) => order[a.setup] - order[b.setup] || b.pump3dPct - a.pump3dPct);

  const metaBySymbol = new Map(all.map((u) => [u.perp.symbol, u]));
  const topGainers: JunkTopGainer[] = tickers
    .filter((t) => metaBySymbol.has(t.symbol))
    .sort((a, b) => Number(b.priceChangePercent) - Number(a.priceChangePercent))
    .slice(0, topN)
    .map((t, idx) => {
      const u = metaBySymbol.get(t.symbol)!;
      const e = bySymbol.get(t.symbol);
      return {
        rank: idx + 1,
        symbol: t.symbol,
        change24hPct: Number(t.priceChangePercent),
        quoteVolume24hUsdM: sig4(Number(t.quoteVolume) / 1e6, 3),
        price: sig4(Number(t.lastPrice), 6),
        fundingPct: sig4((funding.get(t.symbol) ?? 0) * 100, 3),
        spotListed: spot.has(u.perp.baseAsset),
        marketCapUsdM: u.mc != null ? sig4(u.mc / 1e6, 3) : null,
        listingDays: u.listingDays,
        monitoringTag: u.tags.includes('Monitoring'),
        junk: u.notJunkReason == null,
        notJunkReason: u.notJunkReason,
        pump3dIfClosedNowPct: e?.pump3dIfClosedNow != null ? pct(e.pump3dIfClosedNow) : null,
        setup: e?.candidate?.setup ?? null,
      };
    });

  return {
    scannedAt: new Date(now).toISOString(),
    filters: { maxMarketCapUsdM: maxMc / 1e6, minListingDays: minDays, signalCandle: 'last CLOSED D1 (UTC 00:00)' },
    btc: { close: sig4(btcClose, 6), ema50D1: sig4(btcEma50, 6), bear: btcClose < btcEma50 },
    universe: { smallCaps: smallCaps.length, eligible: eligible.length, excludedTooNew: tooNew.map((u) => u.perp.symbol) },
    candidates,
    topGainers,
    topGainersSummary: {
      count: topGainers.length,
      junk: topGainers.filter((g) => g.junk).length,
      notOnSpot: topGainers.filter((g) => !g.spotListed).length,
      overCap: topGainers.filter((g) => g.notJunkReason?.startsWith('market cap')).length,
      tooNew: topGainers.filter((g) => g.notJunkReason?.startsWith('futures listed')).length,
    },
  };
}

const fmtPrice = (n: number) => (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(sig4(n, 4)));

/** Telegram (HTML) message for new setup-A coins and junk coins pumping hard intraday. */
export function formatJunkShortAlert(input: {
  btcBear: boolean;
  setupA: readonly JunkCandidate[];
  movers: readonly JunkTopGainer[];
}): string {
  const lines: string[] = ['🗑️ <b>SHORT COIN RÁC</b> — Binance (vốn hoá ≤ $100M, list ≥ 90 ngày)'];
  lines.push(input.btcBear ? '🐻 BTC D1 dưới EMA50 — edge setup A mạnh (win ~86%)' : '🐂 BTC D1 trên EMA50 — edge setup A yếu hơn (win ~67%), giảm size');
  if (input.setupA.length) {
    lines.push('', '<b>Setup A · pump ≥ +50%/3D (nến D1 đã đóng)</b>');
    for (const c of input.setupA) {
      const flags = [c.monitoringTag ? '⚠️Monitoring' : '', c.fundingPct <= -0.1 ? `⚠️funding ${c.fundingPct}%` : '', c.marketCapUsdM < 5 ? '⚠️cap<5M' : '']
        .filter(Boolean)
        .join(' ');
      lines.push(
        `• <b>${c.symbol}</b> +${c.pump3dPct}% · cap ${c.marketCapUsdM}M · giá ${fmtPrice(c.price)} ${flags}`,
        `  3 tầng ${c.plan.entries.map(fmtPrice).join(' / ')} · stop ${fmtPrice(c.plan.hardStop)} · TP TB −20% · tối đa 30 ngày`,
      );
    }
  }
  if (input.movers.length) {
    lines.push('', '<b>Coin rác trong top tăng 24h (theo dõi, chưa vào)</b>');
    for (const m of input.movers) {
      const p3 = m.pump3dIfClosedNowPct != null ? ` · 3D nếu đóng giờ: +${m.pump3dIfClosedNowPct}%` : '';
      lines.push(`• <b>${m.symbol}</b> #${m.rank} +${sig4(m.change24hPct, 3)}%/24h · cap ${m.marketCapUsdM}M${p3}`);
    }
  }
  lines.push('', 'Size ≤ 5% tài khoản cho cả 3 tầng, đòn bẩy ≤ x3, isolated, stop cứng bắt buộc.');
  return lines.join('\n');
}
