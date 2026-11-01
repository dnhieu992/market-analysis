import { calculateEma } from '../indicators/ema';
import { calculateQqe, type QqeCross } from '../indicators/qqe';
import { calculateRsi } from '../indicators/rsi';

/**
 * QQE params used everywhere the trader sees QQE (Setup-tab column, chart
 * renderer, `<exchange>_signals` tool, Telegram alerts). Entry features MUST use
 * the same numbers so "QQE D1 long" in a stored entry means what the trader saw.
 */
export const APP_QQE_PARAMS = { rsiPeriod: 10, smoothing: 4, qqeFactor: 3.2 } as const;

/** Bump when the feature definitions change, so old/new snapshots are not mixed blindly. */
export const ENTRY_FEATURE_SET_VERSION = 1;

/** One CLOSED candle. */
export type EntryCandle = { closeTime: number; high: number; low: number; close: number };

/** Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...]. */
export type RawKlineRow = ReadonlyArray<string | number>;

export function candlesFromKlines(rows: readonly RawKlineRow[], asOfMs: number): EntryCandle[] {
  return rows
    .map((r) => ({ closeTime: Number(r[6]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) }))
    .filter((c) => Number.isFinite(c.close) && c.closeTime <= asOfMs);
}

export type QqeState = 'long' | 'short';

export type EntryFeatures = {
  featureSetVersion: number;
  /** When the snapshot was taken (entry time). */
  at: string;
  price: number;
  qqeD1: QqeState | null;
  /** D1 candles since the last QQE D1 flip (0 = flipped on the last closed candle). */
  qqeD1BarsSinceCross: number | null;
  qqeH4: QqeState | null;
  qqe1h: QqeState | null;
  rsiD1: number | null;
  rsiH4: number | null;
  rsi1h: number | null;
  ema34D1: number | null;
  ema89D1: number | null;
  /** (price ÷ EMA − 1) × 100 */
  distEma34D1Pct: number | null;
  distEma89D1Pct: number | null;
  /** EMA34 D1 now vs 5 candles ago, % */
  ema34D1Slope5Pct: number | null;
  ema89H4: number | null;
  distEma89H4Pct: number | null;
  chg24hPct: number | null;
  chg7dPct: number | null;
  chg30dPct: number | null;
  /** Position inside the last-20-day range: 0 = low, 1 = high. */
  range20dPos: number | null;
  btc: { distEma89D1Pct: number | null; chg7dPct: number | null; qqeD1: QqeState | null } | null;
};

const r2 = (n: number | null): number | null => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (a: number, b: number | null | undefined): number | null => (b && b > 0 ? (a / b - 1) * 100 : null);

function qqeState(closes: number[]): { state: QqeState | null; barsSince: number | null } {
  if (closes.length < 60) return { state: null, barsSince: null };
  const { cross } = calculateQqe(closes, APP_QQE_PARAMS.rsiPeriod, APP_QQE_PARAMS.smoothing, APP_QQE_PARAMS.qqeFactor);
  for (let i = cross.length - 1; i >= 0; i--) {
    const c: QqeCross = cross[i] ?? null;
    if (c === 'long' || c === 'short') return { state: c, barsSince: cross.length - 1 - i };
  }
  return { state: null, barsSince: null };
}

const rsiOf = (closes: number[]) => (closes.length > 30 ? r2(calculateRsi(closes, 14)) : null);
const emaOf = (closes: number[], n: number) => (closes.length >= n + 10 ? calculateEma(closes, n) : null);

/**
 * Market snapshot at an entry, from CLOSED candles only (no repaint):
 * D1 ≥ ~120 candles, H4 ≥ ~100, 1h ≥ ~50. Missing timeframes yield nulls.
 * `price` is the entry price (distances are measured from it).
 */
export function computeEntryFeatures(input: {
  at: Date;
  price: number;
  d1: EntryCandle[];
  h4: EntryCandle[];
  h1: EntryCandle[];
  btcD1?: EntryCandle[] | null;
}): EntryFeatures {
  const { price } = input;
  const d = input.d1.map((c) => c.close);
  const h = input.h4.map((c) => c.close);
  const m = input.h1.map((c) => c.close);
  const qD = qqeState(d);
  const ema34 = emaOf(d, 34);
  const ema89 = emaOf(d, 89);
  const ema34Prev = d.length > 50 ? emaOf(d.slice(0, -5), 34) : null;
  const ema89h4 = emaOf(h, 89);
  const last20 = input.d1.slice(-20);
  const lo20 = last20.length ? Math.min(...last20.map((c) => c.low)) : NaN;
  const hi20 = last20.length ? Math.max(...last20.map((c) => c.high)) : NaN;
  const back = (arr: number[], n: number) => (arr.length > n ? arr[arr.length - 1 - n] : undefined);

  let btc: EntryFeatures['btc'] = null;
  if (input.btcD1 && input.btcD1.length > 100) {
    const b = input.btcD1.map((c) => c.close);
    const bLast = b[b.length - 1]!;
    btc = {
      distEma89D1Pct: r2(pct(bLast, emaOf(b, 89))),
      chg7dPct: r2(pct(bLast, back(b, 7))),
      qqeD1: qqeState(b).state,
    };
  }

  return {
    featureSetVersion: ENTRY_FEATURE_SET_VERSION,
    at: input.at.toISOString(),
    price,
    qqeD1: qD.state,
    qqeD1BarsSinceCross: qD.barsSince,
    qqeH4: qqeState(h).state,
    qqe1h: qqeState(m).state,
    rsiD1: rsiOf(d),
    rsiH4: rsiOf(h),
    rsi1h: rsiOf(m),
    ema34D1: ema34,
    ema89D1: ema89,
    distEma34D1Pct: r2(pct(price, ema34)),
    distEma89D1Pct: r2(pct(price, ema89)),
    ema34D1Slope5Pct: ema34 != null && ema34Prev != null ? r2(pct(ema34, ema34Prev)) : null,
    ema89H4: ema89h4,
    distEma89H4Pct: r2(pct(price, ema89h4)),
    // 24h = 24 closed 1h candles back (falls back to 6 H4 candles).
    chg24hPct: r2(m.length > 24 ? pct(price, back(m, 23)) : pct(price, back(h, 5))),
    chg7dPct: r2(pct(price, back(d, 6))),
    chg30dPct: r2(pct(price, back(d, 29))),
    range20dPos: Number.isFinite(lo20) && hi20 > lo20 ? r2((price - lo20) / (hi20 - lo20)) : null,
    btc,
  };
}

/** Exchange symbol → Binance spot symbol (Bitget/MEXC names that differ). */
const BINANCE_ALIAS: Record<string, string> = { FILECOINUSDT: 'FILUSDT' };
export function binanceSymbolOf(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pairName = s.endsWith('USDT') ? s : `${s}USDT`;
  return BINANCE_ALIAS[pairName] ?? pairName;
}

/** Fetch klines `{ symbol (Binance), interval, limit, endTime? }` → raw rows. */
export type EntryKlineFetcher = (args: {
  symbol: string;
  interval: '1d' | '4h' | '1h';
  limit: number;
  endTime?: number;
}) => Promise<readonly RawKlineRow[]>;

/**
 * Fetch the candles and compute the features for `symbol` as of `at` (now for a
 * live entry, the open time for a backfill). Returns null when the coin has no
 * Binance market or too little history.
 */
export async function fetchEntryFeatures(
  fetcher: EntryKlineFetcher,
  symbol: string,
  at: Date,
  price: number | null,
  btcD1?: EntryCandle[] | null,
): Promise<EntryFeatures | null> {
  const bin = binanceSymbolOf(symbol);
  const asOf = at.getTime();
  const isLive = Date.now() - asOf < 10 * 60_000;
  const endTime = isLive ? undefined : asOf;
  const [d1, h4, h1] = await Promise.all([
    fetcher({ symbol: bin, interval: '1d', limit: 200, endTime }),
    fetcher({ symbol: bin, interval: '4h', limit: 200, endTime }),
    fetcher({ symbol: bin, interval: '1h', limit: 100, endTime }),
  ]);
  const D = candlesFromKlines(d1, asOf);
  const H = candlesFromKlines(h4, asOf);
  const M = candlesFromKlines(h1, asOf);
  if (D.length < 60 || H.length < 60) return null;
  let btc = btcD1 ?? null;
  if (!btc && bin !== 'BTCUSDT') {
    btc = candlesFromKlines(await fetcher({ symbol: 'BTCUSDT', interval: '1d', limit: 200, endTime }), asOf);
  } else if (!btc) btc = D;
  const px = price != null && price > 0 ? price : (M[M.length - 1] ?? H[H.length - 1])!.close;
  return computeEntryFeatures({ at, price: px, d1: D, h4: H, h1: M, btcD1: btc });
}
