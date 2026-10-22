import { calculateAtr, calculateEma, calculateRsi } from '@app/core';

import type { ChatTool } from '../contracts/chat-tool';

const BASE = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';

type KlineRow = [number, string, string, string, string, string, number, ...unknown[]];

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

// Enough bars per timeframe to redraw the chart: 30m ≈ 2 days, 15m ≈ 1 day, 5m ≈ 12 hours.
const TIMEFRAMES = [
  { interval: '30m', limit: 96 },
  { interval: '15m', limit: 96 },
  { interval: '5m', limit: 144 }
] as const;

async function fetchBars(symbol: string, interval: string, limit: number): Promise<Bar[]> {
  const res = await fetch(`${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance API error ${res.status} for ${symbol} ${interval}`);
  const rows = (await res.json()) as KlineRow[];
  return rows.map((r) => ({
    t: r[0],
    o: parseFloat(r[1]),
    h: parseFloat(r[2]),
    l: parseFloat(r[3]),
    c: parseFloat(r[4]),
    v: parseFloat(r[5])
  }));
}

// Significant digits, so micro-priced coins keep their precision.
const px = (n: number) => Number(n.toPrecision(7));
const vol = (n: number) => Number(n.toPrecision(4));

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
}

/** Fractal swing points: a bar whose high/low beats `side` bars on each side. */
function swings(bars: readonly Bar[], side = 2) {
  const highs: Array<{ time: string; price: number }> = [];
  const lows: Array<{ time: string; price: number }> = [];
  for (let i = side; i < bars.length - side; i++) {
    const bar = bars[i]!;
    const around = [...bars.slice(i - side, i), ...bars.slice(i + 1, i + 1 + side)];
    if (around.every((b) => b.h < bar.h)) highs.push({ time: fmtTime(bar.t), price: px(bar.h) });
    if (around.every((b) => b.l > bar.l)) lows.push({ time: fmtTime(bar.t), price: px(bar.l) });
  }
  return { swingHighs: highs.slice(-6), swingLows: lows.slice(-6) };
}

function summarize(interval: string, bars: readonly Bar[]) {
  // The last bar is still forming — indicators use closed bars only.
  const closed = bars.slice(0, -1);
  const closes = closed.map((b) => b.c);
  const volumes = closed.map((b) => b.v);
  const avgVol20 = volumes.slice(-20).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(20, volumes.length));
  const lastClosed = closed[closed.length - 1];

  return {
    interval,
    from: fmtTime(bars[0]!.t),
    to: fmtTime(bars[bars.length - 1]!.t),
    indicators: {
      ema9: px(calculateEma(closes, 9)),
      ema21: px(calculateEma(closes, 21)),
      ema50: px(calculateEma(closes, 50)),
      rsi14: Number(calculateRsi(closes, 14).toFixed(1)),
      atr14: px(calculateAtr(closed.map((b) => b.h), closed.map((b) => b.l), closes, 14)),
      avgVolume20: vol(avgVol20),
      lastClosedVolumeRatio: lastClosed && avgVol20 > 0 ? Number((lastClosed.v / avgVol20).toFixed(2)) : null
    },
    rangeHigh: px(Math.max(...bars.map((b) => b.h))),
    rangeLow: px(Math.min(...bars.map((b) => b.l))),
    ...swings(closed),
    // Compact CSV keeps ~340 candles affordable in tokens.
    columns: 'time(UTC),open,high,low,close,volume',
    candles: bars.map((b) => `${fmtTime(b.t)},${px(b.o)},${px(b.h)},${px(b.l)},${px(b.c)},${vol(b.v)}`).join('\n'),
    note: 'Last candle is still forming (not closed).'
  };
}

/** Today's (UTC) open/high/low and VWAP from 5m bars. */
function session(bars5m: readonly Bar[]) {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const today = bars5m.filter((b) => b.t >= dayStart.getTime());
  if (today.length === 0) return null;

  let pv = 0;
  let v = 0;
  for (const b of today) {
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    v += b.v;
  }

  return {
    sessionStartUtc: dayStart.toISOString(),
    open: px(today[0]!.o),
    high: px(Math.max(...today.map((b) => b.h))),
    low: px(Math.min(...today.map((b) => b.l))),
    vwap: v > 0 ? px(pv / v) : null
  };
}

export const getScalpChartDataTool: ChatTool<{ symbol: string }, string> = {
  name: 'get_scalp_chart_data',
  description:
    'Fetch full candle data for scalping on 30m (~2 days), 15m (~1 day) and 5m (~12 hours) from Binance — ' +
    'enough to reconstruct the chart — plus EMA9/21/50, RSI14, ATR14, volume ratio, recent swing highs/lows ' +
    'per timeframe and today\'s UTC session open/high/low/VWAP. Use this as the primary tool for scalping questions.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Trading pair symbol, e.g. BTCUSDT, ETHUSDT' }
    },
    required: ['symbol']
  },
  async execute(input) {
    const raw = input.symbol.toUpperCase();
    const symbol = raw.endsWith('USDT') ? raw : `${raw}USDT`;

    const series = await Promise.all(TIMEFRAMES.map((tf) => fetchBars(symbol, tf.interval, tf.limit)));
    if (series.some((bars) => bars.length < 30)) {
      return JSON.stringify({ error: `Insufficient candle data for ${symbol}` });
    }

    const bars5m = series[2]!;
    return JSON.stringify({
      symbol,
      generatedAtUtc: new Date().toISOString(),
      lastPrice: px(bars5m[bars5m.length - 1]!.c),
      session: session(bars5m),
      timeframes: TIMEFRAMES.map((tf, i) => summarize(tf.interval, series[i]!))
    });
  }
};
