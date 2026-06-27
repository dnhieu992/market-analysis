/**
 * Backtest a D1 DEEP-DIP REVERSAL (oversold bounce) strategy — the user's
 * "mua khi giá đã điều chỉnh sâu, sắp hồi / khó giảm thêm" idea, WITHOUT a
 * trend filter, but WITH the refinements that the naive EMA34 dip-buy lacked:
 *
 *   LONG only, D1:
 *     Entry (all must hold on a CLOSED daily candle):
 *       1. Oversold:        RSI(14) <= rsiMax            (sweep)
 *       2. Near support:    close within `nearLowPct`% above the rolling
 *                           `lowWindow`-day low (i.e. we're at the bottom of
 *                           the recent range, not mid-air)
 *       3. Stabilization:   (optional, `stab=1`) the candle TURNS UP —
 *                           close > open AND close > previous close —
 *                           so we don't buy a knife still in freefall.
 *       Enter at that candle's close. One position at a time.
 *     Stop loss:  structural — just below the rolling low: recentLow*(1-slBufPct%).
 *                 Skip the setup entirely if that implies risk > maxRiskPct%
 *                 (enforces "low-risk entries only").
 *     Take profit: a later candle's HIGH touches EMA34 (mean reversion target).
 *                 Exit at EMA34. SL checked BEFORE TP within a bar (worst case).
 *     Final open position marked-to-market at the last close.
 *
 * Sweep `rsiMax`. $1000 compounded, no leverage, fee on BOTH sides.
 * Run on the SAME coins as the naive run (incl. the killers SOL/POL) so the
 * two are directly comparable. Results exclude slippage & funding.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-dip-reversal-d1-backtest.ts \
 *     [symbols] [interval] [days] [capital] [feePctPerSide] [rsiMaxList] [nearLowPct] [lowWindow] [slBufPct] [maxRiskPct] [stab]
 *   e.g. ... "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,POLUSDT,TAOUSDT" 1d 2200 1000 0.05 "25,30,35,40" 6 20 3 18 1
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

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
        openTime: new Date(k[0] as number),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

// EMA seeded with an SMA of the first `period` closes.
function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder RSI.
function rsi(closes: number[], period: number): number[] {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Trade = { retPct: number; barsHeld: number; reason: 'tp' | 'sl' | 'eod' };

function runDip(
  candles: Candle[],
  opts: { rsiMax: number; nearLowPct: number; lowWindow: number; slBufPct: number; maxRiskPct: number; stab: boolean; feePerSide: number; capital: number; emaPeriod: number },
) {
  const { rsiMax, nearLowPct, lowWindow, slBufPct, maxRiskPct, stab, feePerSide, capital, emaPeriod } = opts;
  const closes = candles.map((c) => c.close);
  const e = ema(closes, emaPeriod);
  const r = rsi(closes, 14);
  const fee = feePerSide / 100;
  const warmup = Math.max(emaPeriod, lowWindow, 15);

  const ret = (entry: number, exit: number) => (exit - entry) / entry - 2 * fee; // long

  const trades: Trade[] = [];
  let equity = capital;
  let barsInMarket = 0;
  let skippedRisk = 0;
  let pos: { entry: number; entryIdx: number; stop: number } | null = null;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const em = e[i]!;
    if (!isFinite(em)) continue;

    if (pos === null) {
      const ri = r[i]!;
      if (!isFinite(ri) || ri > rsiMax) continue;
      // Rolling low over the prior `lowWindow` bars = the established support.
      let recentLow = Infinity;
      for (let j = i - lowWindow; j < i; j++) recentLow = Math.min(recentLow, candles[j]!.low);
      if (!isFinite(recentLow) || recentLow <= 0) continue;
      // Near support: close within nearLowPct% above the recent low.
      if ((c.close - recentLow) / recentLow > nearLowPct / 100) continue;
      // Stabilization: candle turns up (not still in freefall).
      if (stab && !(c.close > c.open && c.close > candles[i - 1]!.close)) continue;

      const stop = recentLow * (1 - slBufPct / 100);
      const riskPct = (c.close - stop) / c.close * 100;
      if (riskPct <= 0 || riskPct > maxRiskPct) { skippedRisk++; continue; }

      pos = { entry: c.close, entryIdx: i, stop };
      continue;
    }

    barsInMarket++;
    if (c.low <= pos.stop) {
      const rr = ret(pos.entry, pos.stop);
      equity *= 1 + rr;
      trades.push({ retPct: rr, barsHeld: i - pos.entryIdx, reason: 'sl' });
      pos = null;
      continue;
    }
    if (c.high >= em) {
      const rr = ret(pos.entry, em);
      equity *= 1 + rr;
      trades.push({ retPct: rr, barsHeld: i - pos.entryIdx, reason: 'tp' });
      pos = null;
      continue;
    }
  }

  if (pos) {
    const last = candles[candles.length - 1]!;
    const rr = ret(pos.entry, last.close);
    equity *= 1 + rr;
    trades.push({ retPct: rr, barsHeld: candles.length - 1 - pos.entryIdx, reason: 'eod' });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  const tps = trades.filter((t) => t.reason === 'tp').length;
  const sls = trades.filter((t) => t.reason === 'sl').length;
  const avgBars = trades.length ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0;
  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  const exposure = candles.length > warmup ? barsInMarket / (candles.length - warmup) : 0;

  return {
    trades: trades.length, wins, tps, sls, skippedRisk,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    exposure: exposure * 100,
    avgBars,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, rsiArg, nearArg, winArg, slBufArg, maxRiskArg, stabArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,POLUSDT,TAOUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '1d';
  const days = Number(daysArg ?? 2200);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const rsiMaxList = (rsiArg ?? '25,30,35,40').split(',').map(Number);
  const nearLowPct = Number(nearArg ?? 6);
  const lowWindow = Number(winArg ?? 20);
  const slBufPct = Number(slBufArg ?? 3);
  const maxRiskPct = Number(maxRiskArg ?? 18);
  const stab = (stabArg ?? '1') === '1';
  const emaPeriod = 34;

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  const dataBySymbol = new Map<string, Candle[]>();
  for (const symbol of symbols) {
    const c = await fetchKlines(symbol, interval, startMs, endMs);
    dataBySymbol.set(symbol, c);
    const span = c.length ? `${c[0]!.openTime.toISOString().slice(0, 10)} → ${c[c.length - 1]!.openTime.toISOString().slice(0, 10)}` : 'no data';
    console.log(`data ${symbol.padEnd(10)} ${String(c.length).padStart(5)} candles  (${span})`);
  }

  for (const rsiMax of rsiMaxList) {
    console.log(`\n=== DIP-REVERSAL LONG | RSI<=${rsiMax} | near ${lowWindow}d-low <=${nearLowPct}% | stab=${stab ? 'ON' : 'off'} | SL=below low -${slBufPct}% (maxRisk ${maxRiskPct}%) | TP=touch EMA${emaPeriod} | ${interval} ${days}d $${capital} fee ${feePerSide}%/side ===`);
    console.log('symbol     | trades | TP | SL | skip | winRate |   final$   | return% | maxDD% | avgBars | expo%');
    for (const symbol of symbols) {
      const candles = dataBySymbol.get(symbol)!;
      if (!candles || candles.length === 0) { console.log(`${symbol.padEnd(10)} | no data`); continue; }
      const x = runDip(candles, { rsiMax, nearLowPct, lowWindow, slBufPct, maxRiskPct, stab, feePerSide, capital, emaPeriod });
      console.log(
        `${symbol.padEnd(10)} | ${String(x.trades).padStart(6)} | ${String(x.tps).padStart(2)} | ${String(x.sls).padStart(2)} | ${String(x.skippedRisk).padStart(4)} | ${fmt(x.winRate * 100).padStart(6)}% | ${('$' + fmt(x.finalEquity)).padStart(10)} | ${((x.returnPct >= 0 ? '+' : '') + fmt(x.returnPct)).padStart(8)} | ${fmt(x.maxDD).padStart(6)} | ${fmt(x.avgBars, 1).padStart(7)} | ${fmt(x.exposure).padStart(5)}`,
      );
    }
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
