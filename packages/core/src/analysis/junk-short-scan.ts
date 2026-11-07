/**
 * "Short coin rác" scanner — shared by the API chat tool (`scan_junk_shorts`) and the
 * worker Telegram alert. A coin is "junk" when it is listed on BOTH Binance spot (USDT) and
 * Binance USDT-M perpetuals, futures listed ≥ 90 days, and — measured BEFORE the pump
 * (3 days before the signal candle; at the signal candle for setup B) —
 *   · market cap $20M–$500M (current circulating supply × the price then), and
 *   · price ≥ 50% below its all-time high (futures weekly + daily highs before that day).
 * Filtering on TODAY's cap was look-ahead (coins small today are the ones that fell) and
 * dropped coins the pump itself had lifted over the ceiling — see the v2 section of the study.
 * Setups come from the 2026-11-03 study (claude-backtest/runs/2026-11-03-junk-short-patterns.md):
 *   A. pump fade  — 3-day close-to-close ≥ +50% on the last CLOSED D1 candle
 *   B. EMA bounce — D1 downtrend, red candle wicks into EMA20 but closes under EMA50
 * Also returns Binance's top 24h gainers, since junk coins live there.
 * With `symbols` (the user's hand-kept junk list on /short-junk) ONLY those coins are scanned —
 * setups, top gainers and all — and the cap / ATH / listing-age / spot gates no longer drop a
 * coin: the user already decided it is junk, so a failed gate is returned as a warning instead.
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
  /** Market cap now (after any pump). */
  marketCapUsdM: number;
  /** Market cap at the reference day (before the pump for A/WATCH, signal day for B) — what the filter uses. */
  capBeforePumpUsdM: number;
  /** % below the all-time high at the reference day. */
  belowAthPct: number;
  athPrice: number;
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
  /** List mode only: the study's junk gates this coin fails (it is still scanned, the user listed it). */
  warnings: string[];
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
  /** Cap 3 days ago (before today's / this pump) — what the junk filter uses. */
  capBeforePumpUsdM: number | null;
  belowAthPct: number | null;
  listingDays: number;
  monitoringTag: boolean;
  /** Passes the junk definition measured before the pump. */
  junk: boolean;
  notJunkReason: string | null;
  /** 3-day pump if today's D1 candle closed at the current price — ≥ 50 means setup A tomorrow. */
  pump3dIfClosedNowPct: number | null;
  /** Setup already printed on the last closed candle, if any. */
  setup: JunkSetup | null;
};

export type JunkShortScan = {
  scannedAt: string;
  filters: {
    capBeforePumpUsdM: [number, number];
    minBelowAthPct: number;
    minListingDays: number;
    signalCandle: string;
  };
  btc: { close: number; ema50D1: number; bear: boolean };
  universe: {
    /** 'list' = only the user's junk list was scanned; 'all' = every Binance perp through the junk gates. */
    source: 'list' | 'all';
    /** List mode: listed coins with no trading Binance USDT-M perpetual (cannot be shorted there). */
    notOnBinanceFutures: string[];
    scanned: number;
    junkToday: number;
    /** Coins passing every junk gate on the last closed D1 — what "Sync từ Binance" on /short-junk imports. */
    junkTodayCoins: Array<{ symbol: string; capUsdM: number; belowAthPct: number; listingDays: number }>;
    excludedTooNew: string[];
  };
  candidates: JunkCandidate[];
  topGainers: JunkTopGainer[];
  topGainersSummary: { count: number; junk: number; notOnSpot: number; capOutOfRange: number; nearAth: number; tooNew: number };
};

export type JunkShortScanOptions = {
  minMarketCapUsd?: number;
  maxMarketCapUsd?: number;
  minBelowAth?: number;
  minListingDays?: number;
  topGainers?: number;
  fapiBaseUrl?: string;
  now?: number;
  /** Scan ONLY these USDT-M symbols (e.g. ['ORDIUSDT']). Omit to scan every Binance perp. */
  symbols?: readonly string[];
};

export const JUNK_PUMP_A = 0.5;
export const JUNK_PUMP_WATCH = 0.3;
export const JUNK_DEFAULT_MIN_MC = 20e6;
export const JUNK_DEFAULT_MAX_MC = 500e6;
export const JUNK_DEFAULT_MIN_BELOW_ATH = 0.5;
export const JUNK_DEFAULT_MIN_LISTING_DAYS = 90;

const PRODUCTS_URL = 'https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=false';
const DAY_MS = 86_400_000;
const KLINE_LIMIT = 200; // enough history for EMA50 to settle
const WEEKLY_LIMIT = 499; // ~9.5 years — all of Binance futures history; < 500 keeps request weight at 2
const ATH_CACHE_MS = 24 * 3_600_000;
/** Coins capped above max × this today are skipped without fetching: a pump that big from ≤ max never happens. */
const PREFILTER_CAP_MULT = 4;
const CONCURRENCY = 8;

/** Weekly futures bars per symbol, cached — the all-time high barely moves day to day. */
const weeklyCache = new Map<string, { at: number; bars: JunkBar[] }>();

export type JunkEligibility = { junk: boolean; capUsd: number; belowAth: number; athPrice: number; reason: string | null };

/**
 * The junk definition at reference day `ref` (index into `closed`): cap = supply × close then,
 * drawdown vs the highest high before that day. Pure — pinned by the spec.
 */
export function junkEligibilityAt(
  closed: readonly JunkBar[],
  weekly: readonly JunkBar[],
  ref: number,
  circulatingSupply: number,
  opts: { minCap: number; maxCap: number; minBelowAth: number },
): JunkEligibility {
  const day = at(closed, ref);
  let ath = 0;
  for (const w of weekly) if (w.t + 7 * DAY_MS <= day.t && w.h > ath) ath = w.h;
  for (let j = 0; j < ref; j++) ath = Math.max(ath, at(closed, j).h);
  const capUsd = circulatingSupply * day.c;
  const belowAth = ath > 0 ? 1 - day.c / ath : 0;
  const reason =
    capUsd < opts.minCap
      ? `cap before pump < $${opts.minCap / 1e6}M`
      : capUsd > opts.maxCap
        ? `cap before pump > $${opts.maxCap / 1e6}M`
        : belowAth < opts.minBelowAth
          ? `only ${Math.round(belowAth * 100)}% below ATH (< ${opts.minBelowAth * 100}%)`
          : null;
  return { junk: reason == null, capUsd, belowAth, athPrice: ath, reason };
}

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
  const minCap = opts.minMarketCapUsd != null && opts.minMarketCapUsd >= 0 ? opts.minMarketCapUsd : JUNK_DEFAULT_MIN_MC;
  const maxCap = opts.maxMarketCapUsd && opts.maxMarketCapUsd > minCap ? opts.maxMarketCapUsd : JUNK_DEFAULT_MAX_MC;
  const minBelowAth = opts.minBelowAth != null && opts.minBelowAth >= 0 && opts.minBelowAth < 1 ? opts.minBelowAth : JUNK_DEFAULT_MIN_BELOW_ATH;
  const minDays = opts.minListingDays != null && opts.minListingDays >= 0 ? opts.minListingDays : JUNK_DEFAULT_MIN_LISTING_DAYS;
  const topN = Math.min(Math.max(opts.topGainers ?? 20, 0), 50);
  const now = opts.now ?? Date.now();
  const rule = { minCap, maxCap, minBelowAth };

  const bars = async (symbol: string, interval: '1d' | '1w', limit: number): Promise<JunkBar[]> => {
    const rows = await getJson<unknown[][]>(`${fapi}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    return rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), qv: Number(r[7]) }));
  };
  const weeklyBars = async (symbol: string): Promise<JunkBar[]> => {
    const hit = weeklyCache.get(symbol);
    if (hit && now - hit.at < ATH_CACHE_MS) return hit.bars;
    const w = await bars(symbol, '1w', WEEKLY_LIMIT);
    weeklyCache.set(symbol, { at: now, bars: w });
    return w;
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

  const listSet = opts.symbols ? new Set(opts.symbols.map((x) => x.toUpperCase())) : null;
  const listMode = listSet != null;
  const perps = info.symbols.filter(
    (s) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING' && (!listSet || listSet.has(s.symbol)),
  );
  const notOnBinanceFutures = listSet ? [...listSet].filter((sym) => !perps.some((p) => p.symbol === sym)) : [];
  const all = perps.map((s) => {
    const p = spot.get(s.baseAsset);
    const supply = p?.cs ?? 0;
    const mc = p ? supply * Number(p.c) : null;
    const listingDays = Math.floor((now - s.onboardDate) / DAY_MS);
    // Reasons decidable without candles; the cap/ATH test needs the price history below.
    const preReason = !p
      ? 'not on Binance spot'
      : !mc
        ? 'no market-cap data'
        : listingDays < minDays
          ? `futures listed < ${minDays} days`
          : mc > maxCap * PREFILTER_CAP_MULT
            ? `cap > $${(maxCap * PREFILTER_CAP_MULT) / 1e6}M`
            : null;
    return { perp: s, supply, mc, listingDays, tags: p?.tags ?? [], preReason };
  });
  // List mode: every listed coin is scanned; the gates become warnings on the result.
  const scanned = listMode ? all : all.filter((u) => u.preReason == null);
  const tooNew = listMode ? [] : all.filter((u) => u.preReason?.startsWith('futures listed') && u.mc != null && u.mc <= maxCap);

  // BTC regime — the single biggest filter in the study (setup A win 86% vs 67%).
  const btcClosed = (await bars('BTCUSDT', '1d', KLINE_LIMIT)).slice(0, -1);
  if (btcClosed.length < 51) throw new Error('not enough BTC history');
  const btcEma50 = at(emaSeries(btcClosed.map((b) => b.c), 50), -1);
  const btcClose = at(btcClosed, -1).c;

  const evaluated = await mapLimit(scanned, CONCURRENCY, async (u) => {
    let daily: JunkBar[];
    let weekly: JunkBar[];
    try {
      [daily, weekly] = await Promise.all([bars(u.perp.symbol, '1d', KLINE_LIMIT), weeklyBars(u.perp.symbol)]);
    } catch {
      return null;
    }
    const closed = daily.slice(0, -1); // the last bar is today's, still forming
    const ev = evaluateJunkSetup(closed);
    if (!ev) return null;
    const i = closed.length - 1;
    const today = at(daily, -1);
    const tk = t24.get(u.perp.symbol);
    const price = tk ? Number(tk.lastPrice) : today.c;
    const eligAt = (ref: number) => junkEligibilityAt(closed, weekly, ref, u.supply, rule);
    const junkToday = eligAt(i);
    // Top-gainer view: "before the pump" = 3 days before today's still-forming candle.
    const gainerElig = eligAt(i - 2);
    const pump3dIfClosedNow = price / at(closed, -3).c - 1;

    let candidate: JunkCandidate | null = null;
    if (ev.setup) {
      // A / WATCH are judged on the cap before the pump; B on the signal day itself.
      const elig = eligAt(ev.setup === 'B_EMA_BOUNCE' ? i : i - 3);
      if (elig.junk || listMode) {
        const warnings = listMode
          ? [u.preReason?.startsWith('cap >') ? null : u.preReason, elig.reason].filter((w): w is string => w != null)
          : [];
        const sig = at(closed, -1);
        candidate = {
          symbol: u.perp.symbol,
          setup: ev.setup,
          marketCapUsdM: sig4((u.mc ?? 0) / 1e6, 3),
          capBeforePumpUsdM: sig4(elig.capUsd / 1e6, 3),
          belowAthPct: pct(elig.belowAth),
          athPrice: sig4(elig.athPrice, 6),
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
          warnings,
        };
      }
    }
    return {
      symbol: u.perp.symbol,
      candidate,
      junkToday: junkToday.junk && u.preReason == null,
      junkTodayInfo: { symbol: u.perp.symbol, capUsdM: sig4(junkToday.capUsd / 1e6, 3), belowAthPct: pct(junkToday.belowAth), listingDays: u.listingDays },
      gainerElig,
      pump3dIfClosedNow,
    };
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
      const pre = listMode && u.preReason?.startsWith('cap >') ? null : u.preReason;
      const reason = pre ?? (e ? e.gainerElig.reason : 'not enough candle history');
      return {
        rank: idx + 1,
        symbol: t.symbol,
        change24hPct: Number(t.priceChangePercent),
        quoteVolume24hUsdM: sig4(Number(t.quoteVolume) / 1e6, 3),
        price: sig4(Number(t.lastPrice), 6),
        fundingPct: sig4((funding.get(t.symbol) ?? 0) * 100, 3),
        spotListed: spot.has(u.perp.baseAsset),
        marketCapUsdM: u.mc != null ? sig4(u.mc / 1e6, 3) : null,
        capBeforePumpUsdM: e ? sig4(e.gainerElig.capUsd / 1e6, 3) : null,
        belowAthPct: e ? pct(e.gainerElig.belowAth) : null,
        listingDays: u.listingDays,
        monitoringTag: u.tags.includes('Monitoring'),
        junk: reason == null,
        notJunkReason: reason,
        pump3dIfClosedNowPct: e ? pct(e.pump3dIfClosedNow) : null,
        setup: e?.candidate?.setup ?? null,
      };
    });

  return {
    scannedAt: new Date(now).toISOString(),
    filters: {
      capBeforePumpUsdM: [minCap / 1e6, maxCap / 1e6],
      minBelowAthPct: minBelowAth * 100,
      minListingDays: minDays,
      signalCandle: 'last CLOSED D1 (UTC 00:00); cap & ATH measured 3 days before it for A/WATCH, on it for B',
    },
    btc: { close: sig4(btcClose, 6), ema50D1: sig4(btcEma50, 6), bear: btcClose < btcEma50 },
    universe: {
      source: listMode ? 'list' : 'all',
      notOnBinanceFutures,
      scanned: bySymbol.size,
      junkToday: [...bySymbol.values()].filter((e) => e.junkToday).length,
      junkTodayCoins: [...bySymbol.values()].filter((e) => e.junkToday).map((e) => e.junkTodayInfo),
      excludedTooNew: tooNew.map((u) => u.perp.symbol),
    },
    candidates,
    topGainers,
    topGainersSummary: {
      count: topGainers.length,
      junk: topGainers.filter((g) => g.junk).length,
      notOnSpot: topGainers.filter((g) => !g.spotListed).length,
      capOutOfRange: topGainers.filter((g) => /^cap /.test(g.notJunkReason ?? '')).length,
      nearAth: topGainers.filter((g) => g.notJunkReason?.includes('below ATH')).length,
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
  const lines: string[] = ['🗑️ <b>SHORT COIN RÁC</b> — Binance · danh sách coin rác trên /short-junk'];
  lines.push(input.btcBear ? '🐻 BTC D1 dưới EMA50 — edge setup A mạnh (win ~86%)' : '🐂 BTC D1 trên EMA50 — edge setup A yếu hơn (win ~67%), giảm size');
  if (input.setupA.length) {
    lines.push('', '<b>Setup A · pump ≥ +50%/3D (nến D1 đã đóng)</b>');
    for (const c of input.setupA) {
      const flags = [
        c.monitoringTag ? '⚠️Monitoring' : '',
        c.fundingPct <= -0.1 ? `⚠️funding ${c.fundingPct}%` : '',
        ...(c.warnings ?? []).map((w) => `⚠️${w}`),
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(
        `• <b>${c.symbol}</b> +${c.pump3dPct}% · cap trước pump ${c.capBeforePumpUsdM}M · −${c.belowAthPct}% ATH · giá ${fmtPrice(c.price)} ${flags}`,
        `  3 tầng ${c.plan.entries.map(fmtPrice).join(' / ')} · stop ${fmtPrice(c.plan.hardStop)} · TP TB −20% · tối đa 30 ngày`,
      );
    }
  }
  if (input.movers.length) {
    lines.push('', '<b>Coin rác đang tăng mạnh 24h (theo dõi, chưa vào)</b>');
    for (const m of input.movers) {
      const p3 = m.pump3dIfClosedNowPct != null ? ` · 3D nếu đóng giờ: +${m.pump3dIfClosedNowPct}%` : '';
      lines.push(`• <b>${m.symbol}</b> #${m.rank} +${sig4(m.change24hPct, 3)}%/24h · cap trước pump ${m.capBeforePumpUsdM}M${p3}`);
    }
  }
  lines.push('', 'Size ≤ 5% tài khoản cho cả 3 tầng, đòn bẩy ≤ x3, isolated, stop cứng bắt buộc.');
  return lines.join('\n');
}
