import axios from 'axios';

/** A closed candle as the sandbox sees it — same field names as `@app/core`'s Candle, times in ms. */
export type SandboxCandle = {
  time: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type KlineMarket = 'futures' | 'spot';

export const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
};

const FUTURES_BASE = process.env.BINANCE_FUTURES_BASE_URL ?? 'https://fapi.binance.com';
const SPOT_BASE = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';

type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

async function fetchPage(market: KlineMarket, symbol: string, interval: string, startTime: number): Promise<RawKline[]> {
  const url = market === 'futures' ? `${FUTURES_BASE}/fapi/v1/klines` : `${SPOT_BASE}/api/v3/klines`;
  const limit = market === 'futures' ? 1500 : 1000;
  const res = await axios.get<RawKline[]>(url, { params: { symbol, interval, startTime, limit }, timeout: 15_000 });
  return res.data;
}

/**
 * Every CLOSED candle of `symbol`/`interval` from `fromMs` up to now, paging forward. The still-open
 * last candle is dropped so a strategy can never read a bar that has not finished.
 */
async function fetchAll(market: KlineMarket, symbol: string, interval: string, fromMs: number, maxCandles: number): Promise<SandboxCandle[]> {
  const out: SandboxCandle[] = [];
  const now = Date.now();
  let start = fromMs;
  for (let guard = 0; guard < 500 && out.length < maxCandles; guard++) {
    const page = await fetchPage(market, symbol, interval, start);
    if (!page.length) break;
    for (const k of page) {
      if (k[6] >= now) continue; // not closed yet
      out.push({
        time: k[0],
        closeTime: k[6],
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      });
    }
    const last = page[page.length - 1]!;
    if (last[6] >= now || page.length < 2) break;
    start = last[0] + 1;
  }
  return out.slice(0, maxCandles);
}

export type LoadedSeries = {
  symbol: string;
  interval: string;
  market: KlineMarket;
  candles: SandboxCandle[];
};

/**
 * Futures klines first (the user trades perps); a symbol Binance has no USDT-M contract for falls back
 * to spot. `market: 'spot'` forces spot.
 */
export async function loadSeries(
  symbol: string,
  interval: string,
  fromMs: number,
  market: KlineMarket,
  maxCandles: number,
): Promise<LoadedSeries> {
  const order: KlineMarket[] = market === 'spot' ? ['spot'] : ['futures', 'spot'];
  let lastErr: unknown = null;
  for (const m of order) {
    try {
      const candles = await fetchAll(m, symbol, interval, fromMs, maxCandles);
      if (candles.length) return { symbol, interval, market: m, candles };
    } catch (err) {
      lastErr = err;
    }
  }
  const why = lastErr instanceof Error ? ` (${lastErr.message})` : '';
  throw new Error(`Binance không có dữ liệu ${symbol} ${interval}${why}`);
}
