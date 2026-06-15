/**
 * Standalone backtest runner — fetches REAL Binance klines and runs a strategy
 * through the actual BackTestEngineService. No API/auth required.
 *
 * Usage:
 *   pnpm exec ts-node --project apps/api/tsconfig.json scripts/run-backtest.ts \
 *     [strategy] [symbol] [interval] [days] [volume]
 *
 * Defaults: supertrend-engulfing-mtf BTCUSDT 4h 365 1000
 */
import 'reflect-metadata';
import * as https from 'https';

import { BackTestEngineService } from '../apps/api/src/modules/back-test/back-test-engine.service';
import { SupertrendEngulfingMtfStrategy } from '../apps/api/src/modules/back-test/strategies/supertrend-engulfing-mtf.strategy';
import { SupertrendEngulfingStrategy } from '../apps/api/src/modules/back-test/strategies/supertrend-engulfing.strategy';
import type { IBackTestStrategy } from '../apps/api/src/modules/back-test/strategies/strategy.interface';
import type { Candle } from '@app/core';

const STRATEGIES: Record<string, () => IBackTestStrategy> = {
  'supertrend-engulfing-mtf': () => new SupertrendEngulfingMtfStrategy(),
  'supertrend-engulfing': () => new SupertrendEngulfingStrategy(),
};

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

/** Fetches all klines in [startMs, endMs] paginating MAX_PER_REQ at a time. */
async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const k of batch) {
      candles.push({
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        volume: parseFloat(k[5] as string),
        openTime: new Date(k[0] as number),
        closeTime: new Date(k[6] as number),
      });
    }

    const lastOpen = batch[batch.length - 1]![0] as number;
    if (batch.length < MAX_PER_REQ) break;
    cursor = lastOpen + 1;
  }

  return candles;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

async function main() {
  const [, , stratArg, symArg, intArg, daysArg, volArg, atrArg, kvArg] = process.argv;
  const stratName = stratArg ?? 'supertrend-engulfing-mtf';
  const symbol = symArg ?? 'BTCUSDT';
  const interval = intArg ?? '4h';
  const days = Number(daysArg ?? 365);
  const volume = Number(volArg ?? 1000);
  const params: Record<string, unknown> = {};
  if (atrArg !== undefined) params['atrPeriod'] = Number(atrArg);
  if (kvArg !== undefined) params['keyValue'] = Number(kvArg);

  const factory = STRATEGIES[stratName];
  if (!factory) {
    console.error(`Unknown strategy '${stratName}'. Available: ${Object.keys(STRATEGIES).join(', ')}`);
    process.exit(1);
  }

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  console.log(`\nFetching ${symbol} ${interval} klines for last ${days} days...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  console.log(`Fetched ${candles.length} candles (${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)})`);

  const strategy = factory();
  const engine = new BackTestEngineService();
  const summary = engine.run(strategy, candles, symbol, {}, params, volume);

  const paramStr = Object.keys(params).length ? ` | ${JSON.stringify(params)}` : '';
  console.log(`\n=== BACKTEST: ${stratName} | ${symbol} ${interval} | ${days}d | $${volume}/trade${paramStr} ===`);
  console.log(`Total trades : ${summary.totalTrades}`);
  console.log(`Wins / Losses: ${summary.wins} / ${summary.losses}`);
  console.log(`Win rate     : ${fmt(summary.winRate * 100)}%`);
  console.log(`Total PnL    : $${fmt(summary.totalPnl)}  (${fmt((summary.totalPnl / volume) * 100)}% of per-trade notional)`);
  console.log(`Max drawdown : ${fmt(summary.maxDrawdown * 100)}%`);
  console.log(`Sharpe       : ${summary.sharpeRatio === null ? 'n/a' : fmt(summary.sharpeRatio, 4)}`);

  // Last 10 trades
  const recent = summary.trades.slice(-10);
  if (recent.length) {
    console.log(`\nLast ${recent.length} trades:`);
    console.log('  entry time          dir    entry      exit       pnl       outcome');
    for (const t of recent) {
      const et = t.entryTime ? t.entryTime.toISOString().slice(0, 16).replace('T', ' ') : '—';
      console.log(
        `  ${et}  ${t.direction.padEnd(5)}  ${fmt(t.entryPrice).padStart(9)}  ${fmt(t.exitPrice).padStart(9)}  ${(t.pnl >= 0 ? '+' : '') + fmt(t.pnl)}`.padEnd(70) +
          `  ${t.outcome}`
      );
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
