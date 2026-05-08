import { analyzeMarketStructure } from '@app/core';
import type { Candle } from '@app/core';

import type { ChatTool } from '../contracts/chat-tool';

const BASE = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';

type KlineRow = [number, string, string, string, string, string, number, ...unknown[]];

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error ${res.status} for ${symbol} ${interval}`);
  const rows = (await res.json()) as KlineRow[];
  return rows.map((r) => ({
    openTime: new Date(r[0]),
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5]),
    closeTime: new Date(r[6])
  }));
}

export const analyzeMarketStructureTool: ChatTool<{ symbol: string }, string> = {
  name: 'analyze_market_structure',
  description:
    'Fetch multi-timeframe candles (1W/1D/4H) from Binance and compute full market structure analysis: ' +
    'trend direction and strength, swing highs/lows, key support and resistance zones, ATR, volume metrics, ' +
    'and Fibonacci retracement/extension levels. Use this as the primary analysis tool for price action, ' +
    'swing trading, and breakout skill questions.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Trading pair symbol, e.g. BTCUSDT, ETHUSDT'
      }
    },
    required: ['symbol']
  },
  async execute(input) {
    const symbol = input.symbol.toUpperCase();

    const [weekly, daily, fourHour] = await Promise.all([
      fetchKlines(symbol, '1w', 150),
      fetchKlines(symbol, '1d', 365),
      fetchKlines(symbol, '4h', 360)
    ]);

    if (daily.length < 30) {
      return JSON.stringify({ error: `Insufficient candle data for ${symbol}` });
    }

    const structure = analyzeMarketStructure(symbol, weekly, daily, fourHour);

    // Return a compact summary to save tokens
    return JSON.stringify({
      symbol: structure.symbol,
      currentPrice: structure.currentPrice,
      change24h: structure.change24h,
      change7d: structure.change7d,
      weekly: {
        trend: structure.weekly.trend,
        high52w: structure.weekly.high52w,
        low52w: structure.weekly.low52w,
        positionInRange: structure.weekly.positionInRange,
        topSupport: structure.weekly.support.slice(0, 3).map((l) => ({
          price: l.zoneCenter,
          zone: [l.zoneLow, l.zoneHigh],
          tests: l.testCount,
          strength: l.strength
        })),
        topResistance: structure.weekly.resistance.slice(0, 3).map((l) => ({
          price: l.zoneCenter,
          zone: [l.zoneLow, l.zoneHigh],
          tests: l.testCount,
          strength: l.strength
        })),
        recentSwings: structure.weekly.swings.slice(-5).map((s) => ({
          type: s.type,
          price: s.price,
          time: s.time
        })),
        fib: structure.weekly.fib,
        atrPct: structure.weekly.atrPct,
        volume: structure.weekly.volume
      },
      daily: {
        trend: structure.daily.trend,
        topSupport: structure.daily.support.slice(0, 5).map((l) => ({
          price: l.zoneCenter,
          zone: [l.zoneLow, l.zoneHigh],
          tests: l.testCount,
          strength: l.strength
        })),
        topResistance: structure.daily.resistance.slice(0, 5).map((l) => ({
          price: l.zoneCenter,
          zone: [l.zoneLow, l.zoneHigh],
          tests: l.testCount,
          strength: l.strength
        })),
        recentSwings: structure.daily.swings.slice(-6).map((s) => ({
          type: s.type,
          price: s.price,
          time: s.time
        })),
        fib: structure.daily.fib,
        atrPct: structure.daily.atrPct,
        volume: structure.daily.volume
      },
      fourHour: {
        trend: structure.fourHour.trend,
        topSupport: structure.fourHour.support.slice(0, 4).map((l) => ({
          price: l.zoneCenter,
          zone: [l.zoneLow, l.zoneHigh],
          tests: l.testCount,
          strength: l.strength
        })),
        topResistance: structure.fourHour.resistance.slice(0, 4).map((l) => ({
          price: l.zoneCenter,
          zone: [l.zoneLow, l.zoneHigh],
          tests: l.testCount,
          strength: l.strength
        })),
        recentSwings: structure.fourHour.swings.slice(-6).map((s) => ({
          type: s.type,
          price: s.price,
          time: s.time
        })),
        fib: structure.fourHour.fib,
        atrPct: structure.fourHour.atrPct,
        volume: structure.fourHour.volume
      }
    });
  }
};
