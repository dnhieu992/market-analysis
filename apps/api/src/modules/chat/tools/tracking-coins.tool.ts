import { calculateEma, calculateRsi, type Candle } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { coinMeta } from '../../tracking-coins/spot-portfolio';

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

async function fetchCandles(pair: string, interval: string, limit = BARS): Promise<Candle[]> {
  const res = await fetch(`${BASE}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`);
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

/** Not altcoins for Strategy A's breadth / ranking (BTC & ETH are managed elsewhere). */
const NON_ALT = new Set(['BTCUSDT', 'ETHUSDT', 'USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'USD1USDT', 'PAXGUSDT', 'XAUTUSDT']);

const STABLE = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'EUR', 'AEUR', 'USDE', 'USDS', 'USD1', 'EURI', 'BFUSD', 'PAXG', 'XAUT', 'XUSD', 'RLUSD', 'WBTC', 'WBETH', 'BNSOL', 'U']);
const BREADTH_TTL = 6 * 3600_000; // weekly closes — a few refreshes a day is plenty
let breadthCache: { at: number; value: { pct: number; oversold: number; total: number } } | null = null;

/**
 * Strategy A breadth exactly as backtested: % of ALL Binance USDT altcoins (listed ≥ ~200 days,
 * no BTC/ETH/stables/leveraged tokens) whose last closed weekly RSI14 is below 35.
 */
async function marketBreadth(): Promise<{ pct: number; oversold: number; total: number } | null> {
  if (breadthCache && Date.now() - breadthCache.at < BREADTH_TTL) return breadthCache.value;
  // Only pairs that are TRADING now (ticker endpoints also list halted / delisted pairs).
  const res = await fetch(`${BASE}/api/v3/exchangeInfo?permissions=SPOT`).catch(() => null);
  if (!res?.ok) return breadthCache?.value ?? null;
  const info = (await res.json()) as { symbols: Array<{ symbol: string; quoteAsset: string; status: string }> };
  const pairs = info.symbols
    .filter((x) => x.quoteAsset === 'USDT' && x.status === 'TRADING')
    .map((x) => x.symbol)
    .filter((p) => {
      const b = p.slice(0, -4);
      return !NON_ALT.has(p) && !STABLE.has(b) && !/(UP|DOWN|BULL|BEAR)$/.test(b);
    });
  const rsis = await mapLimit(pairs, CONCURRENCY, async (p) => {
    try {
      const closes = (await fetchCandles(p, '1w', 100)).slice(0, -1).map((x) => x.close);
      return closes.length >= 29 ? calculateRsi(closes, 14) : null;
    } catch {
      return null;
    }
  });
  const ok = rsis.filter((r): r is number => r != null && Number.isFinite(r));
  if (ok.length < 50) return breadthCache?.value ?? null;
  const oversold = ok.filter((r) => r < 35).length;
  breadthCache = { at: Date.now(), value: { pct: (oversold / ok.length) * 100, oversold, total: ok.length } };
  return breadthCache.value;
}

type CoinStat = {
  line: string; rsiW: number | null; vol30: number; weeks: number;
  /** Strategy B: close-to-close drop (%) over 3 / 7 / 30 closed daily candles, as backtested. */
  b3: number | null; b7: number | null; b30: number | null;
  /** Strategy B columns, comma-joined: sigB,sigBAgo,sigBEntry. */
  bCols: string;
};

/** Strategy B trigger on one closed daily candle (thresholds from the 2026-11-07 sweep). */
function strategyBLevel(closes: number[], i: number): '' | 'B' | 'B+' {
  const drop = (w: number) => (i - w >= 0 && closes[i - w]! > 0 ? (closes[i]! / closes[i - w]! - 1) * 100 : null);
  const d3 = drop(3), d7 = drop(7), d30 = drop(30);
  if ((d3 != null && d3 <= -25) || (d7 != null && d7 <= -30)) return 'B+';
  if ((d3 != null && d3 <= -20) || (d7 != null && d7 <= -25) || (d30 != null && d30 <= -40)) return 'B';
  return '';
}

/**
 * Most recent Strategy B trigger within the last 5 closed daily candles: level, how many days ago
 * (0 = the last closed candle) and the trigger close (the backtested entry price).
 */
function strategyB(closes: number[]) {
  const n = closes.length;
  const drop = (w: number) => (n - 1 - w >= 0 ? pct(closes[n - 1]!, closes[n - 1 - w]) : null);
  for (let ago = 0; ago < 5 && n - 1 - ago >= 0; ago++) {
    const lvl = strategyBLevel(closes, n - 1 - ago);
    if (lvl) return { b3: drop(3), b7: drop(7), b30: drop(30), bCols: [lvl, ago, Number(closes[n - 1 - ago]!.toPrecision(6))].join(',') };
  }
  return { b3: drop(3), b7: drop(7), b30: drop(30), bCols: ',,' };
}

async function coinRow(pair: string, name: string, ticker: Ticker | undefined): Promise<CoinStat> {
  try {
    const [d1, h4, w1] = await Promise.all([fetchCandles(pair, '1d'), fetchCandles(pair, '4h'), fetchCandles(pair, '1w', 100)]);
    const wClosed = w1.slice(0, -1).map((x) => x.close);
    const rsiW = wClosed.length > 15 ? calculateRsi(wClosed, 14) : null;
    const d = frame(d1);
    const h = frame(h4);
    const price = ticker ? Number(ticker.lastPrice) : d1[d1.length - 1]!.close;
    const c = d.closes;
    const low20 = Math.min(...d.closed.slice(-20).map((x) => x.low));
    const high90 = Math.max(...d.closed.slice(-90).map((x) => x.high));
    const vol30 = d1.slice(-31, -1).reduce((a, x) => a + x.close * (x.volume ?? 0), 0) / 30;
    const line = [
      pair,
      name.replace(/,/g, ' '),
      Number(price.toPrecision(6)),
      ticker ? r1(Number(ticker.priceChangePercent)) : '',
      r1(pct(price, c[c.length - 3])),
      r1(pct(price, c[c.length - 7])),
      r1(pct(price, c[c.length - 30])),
      r1(pct(price, c[c.length - 90])),
      ticker ? r1(Number(ticker.quoteVolume) / 1e6) : '',
      d.trend,
      r1(d.rsi),
      d.ema,
      h.trend,
      r1(h.rsi),
      h.ema,
      r1(pct(price, low20)),
      r1(pct(price, high90)),
      r1(rsiW),
    ].join(',');
    return { line, rsiW, vol30, weeks: wClosed.length, ...strategyB(c) };
  } catch {
    return { line: `${pair},${name.replace(/,/g, ' ')},không lấy được dữ liệu Binance`, rsiW: null, vol30: 0, weeks: 0, b3: null, b7: null, b30: null, bCols: ',,' };
  }
}

// Several skills may read the list within one reply — rows computed in the last minute are reused.
let cache: { at: number; rows: Map<string, CoinStat> } | null = null;

/**
 * The user's watchlist from /tracking-coins, computed live from Binance daily + 4h candles
 * (the stored scan table is not kept fresh): price, % change, Supertrend D1 (the page's Score),
 * trend / RSI / EMA position on D1 and 4H, distance from the 20-day low and 90-day high.
 */
export const getTrackingCoinsTool: ChatTool<{ symbols?: string[] | string; [key: string]: unknown }, string> = {
  name: 'get_tracking_coins',
  description:
    "Get the user's watchlist (the coins on their Spot Analytic / Tracking Coins page), computed live from Binance: price, 24h/3d/7d/30d/90d " +
    'change, Strategy B crash-rebound signal per coin (sigB/sigBAgo/sigBEntry) + the market-wide Strategy B status in the header, ' +
    '24h volume, trend + RSI14 + price vs EMA34/89/200 on 1D and 4H, distance from the ' +
    '20-day low and 90-day high, weekly RSI14 (rsiW), 30-day volume rank among alts (volRank), Strategy A market breadth (% of all Binance USDT alts with weekly RSI < 35) + regime in the header, the user\'s 0–5 star rating, market cap and sector (L1/L2/Meme/DeFi/AI…). Use it when the user asks about "my coins", "the list", which coin to trade, or to ' +
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
      .map((c) => ({ pair: pairOf(c.symbol), name: c.name || c.symbol, rating: (c as { rating?: number }).rating ?? 0 }));
    const shown = coins.filter((c) => want.size === 0 || want.has(c.pair));
    if (shown.length === 0) {
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

    // Star rating (user) + market cap / sectors (Binance) per coin.
    const meta = new Map((await coinMeta(shown.map((c) => c.pair)).catch(() => [])).map((m) => [`${m.symbol}USDT`, m]));

    // Strategy A: breadth = % of listed ≥1y alts (whole watchlist ≈ top-100 alts by volume) with weekly RSI < 35;
    // volRank = rank by 30-day $ volume among those alts.
    const alts = coins.filter((c) => !NON_ALT.has(c.pair)).map((c) => ({ pair: c.pair, st: rows.get(c.pair)! })).filter((a) => a.st.rsiW != null && a.st.weeks >= 52);
    const rank = new Map([...alts].sort((a, b) => b.st.vol30 - a.st.vol30).map((a, i) => [a.pair, i + 1]));
    const listOversold = alts.filter((a) => (a.st.rsiW as number) < 35).length;
    const mb = await marketBreadth().catch(() => null);

    // Strategy B market crash: median watchlist-alt drop over 3 / 7 / 30 closed daily candles.
    const altStats = coins.filter((c) => !NON_ALT.has(c.pair)).map((c) => rows.get(c.pair)!);
    const med = (xs: Array<number | null>) => {
      const v = xs.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
      if (v.length < 10) return null;
      const m = v.length >> 1;
      return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
    };
    const m3 = med(altStats.map((x) => x.b3)), m7 = med(altStats.map((x) => x.b7)), m30 = med(altStats.map((x) => x.b30));
    const marketB = (m3 != null && m3 <= -15) || (m7 != null && m7 <= -25) || (m30 != null && m30 <= -30);
    const bCount = altStats.filter((x) => x.bCols.startsWith('B')).length;
    const breadth = mb ? mb.pct : NaN;
    const regime = !Number.isFinite(breadth) ? 'không đủ dữ liệu'
      : breadth >= 25 ? 'MÙA MUA (≥25%): mở lệnh bình thường với coin top 100'
      : breadth >= 10 ? 'TRUNG TÍNH (10–25%): chỉ mua coin volRank ≤ 50'
      : 'KHÔNG MỞ LỆNH MỚI (<10%): chỉ giữ và chờ TP';
    const extraOf = (pair: string, rating: number) => {
      const m = meta.get(pair);
      return [rating || '', m?.marketCap ? r1(m.marketCap / 1e6) : '', (m?.sectors ?? []).join(' ')].join(',');
    };

    return [
      `Watchlist (${shown.length}/${coins.length} coin), tính trực tiếp từ nến Binance lúc ${new Date().toISOString().slice(0, 16)}Z.`,
      `Chiến lược A — breadth: ${r1(breadth)}%${mb ? ` (${mb.oversold}/${mb.total} alt USDT trên Binance có RSI tuần < 35)` : ''} → chế độ ${regime}. Trong danh sách theo dõi: ${listOversold}/${alts.length} alt có RSI tuần < 35.`,
      'ema = giá trên(Y)/dưới(N) EMA34,EMA89,EMA200. trend: Up = giá>EMA34>EMA89, Down = giá<EMA34<EMA89, Mixed = lẫn lộn. ' +
        'vs20dLow% / vs90dHigh% = cách đáy 20 ngày / đỉnh 90 ngày. stars = người dùng tự chấm 0–5 sao (trống = chưa chấm). mcapM = vốn hoá triệu USD (Binance). sectors = nhóm (L1, L2, Meme, DeFi, AI…).',
      'rsiW = RSI14 nến tuần đã đóng. volRank = hạng volume $ 30 ngày trong các alt niêm yết ≥1 năm (trống = BTC/ETH/stable hoặc < 1 năm).',
      `Chiến lược B — alt trung vị watchlist (nến D1 đã đóng): 3d ${r1(m3)}%, 7d ${r1(m7)}%, 30d ${r1(m30)}% → ${marketB ? 'THỊ TRƯỜNG ĐANG SẬP KIỂU B (3d ≤ −15% / 7d ≤ −25% / 30d ≤ −30%): cả danh sách có lợi thế hồi +10%' : 'thị trường chưa sập kiểu B'}. ${bCount}/${altStats.length} alt đang có tín hiệu B.`,
      'sigB = tín hiệu Chiến lược B trong 5 nến D1 đóng gần nhất: B = 3d ≤ −20% / 7d ≤ −25% / 30d ≤ −40%; B+ = 3d ≤ −25% / 7d ≤ −30% (trống = không có). sigBAgo = số ngày từ nến kích hoạt (0 = nến D1 vừa đóng). sigBEntry = giá đóng cửa nến kích hoạt (giá vào đã backtest). Mức giảm tính close-to-close trên nến D1 đã đóng, khác chg3d%/chg7d% (giá hiện tại).',
      'pair,name,price,chg24h%,chg3d%,chg7d%,chg30d%,chg90d%,vol24hM,trendD,rsiD,emaD,trend4h,rsi4h,ema4h,vs20dLow%,vs90dHigh%,rsiW,stars,mcapM,sectors,volRank,sigB,sigBAgo,sigBEntry',
      ...shown.map((c) => `${rows.get(c.pair)!.line},${extraOf(c.pair, c.rating)},${rank.get(c.pair) ?? ''},${rows.get(c.pair)!.bCols}`),
    ].join('\n');
  },
};
