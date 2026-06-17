/**
 * EMA 34/89/200 Pullback Strategy (PRO rule set) — built for 30m BTC.
 *
 * TREND FILTER (all must hold on the confirmation/entry candle):
 *   - EMA34 > EMA89 > EMA200
 *   - EMA34 and EMA89 both sloping up (value greater than the prior bar)
 *   - close > EMA200
 *
 * ENTRY LONG (2-candle setup):
 *   1. Pullback candle (i-1): low <= EMA34  AND  close >= EMA89
 *   2. Confirmation candle (i): close > open  AND  close > EMA34
 *   -> enter at the confirmation candle's close
 *
 * STOP LOSS:  min(pullback-candle low, EMA89) * (1 - 0.1%)
 * TAKE PROFIT (scale out):
 *   R = entry - SL
 *   TP1 = entry + 1.5R -> close 50%
 *   TP2 = entry + 3.0R -> close remaining 50%
 * EARLY EXIT (on candle close, exits remaining):  EMA34 < EMA89  OR  close < EMA89
 * FILTERS:  |close - EMA34| / EMA34 <= 1.5%   |   one position at a time
 *
 * $1000 compounded, fee 0.05%/side (charged on entry + every scale-out). If SL and a
 * TP are inside the same candle, SL is assumed hit first (conservative).
 * SL is NOT moved to breakeven after TP1 (rule doesn't specify) — the runner keeps the
 * original SL and the early-exit conditions.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema-pullback-pro-backtest.ts \
 *     [symbols] [interval] [days] [capital] [feePctPerSide] [emaPeriods] [nearPct] [tp1R] [tp2R] [slBufPct]
 *   e.g. ... BTCUSDT 30m 365 1000 0.05 "34,89,200" 1.5 1.5 3 0.1
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

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type ExitKind = 'tp2' | 'tp1+early' | 'tp1+sl' | 'sl' | 'early';
type Trade = { entry: number; entryTime: Date; exitTime: Date; retPct: number; kind: ExitKind };

function runPro(
  candles: Candle[],
  periods: [number, number, number],
  nearPct: number,   // fraction, max distance close<->EMA34
  tp1R: number,
  tp2R: number,
  slBuf: number,     // fraction, SL buffer below the structural low
  capital: number,
  feePerSide: number,
) {
  const closes = candles.map((c) => c.close);
  const [pf, pm, ps] = periods;
  const eF = ema(closes, pf);
  const eM = ema(closes, pm);
  const eS = ema(closes, ps);
  const fee = feePerSide / 100;
  const warmup = Math.max(pf, pm, ps) + 1;

  const trades: Trade[] = [];
  let equity = capital;
  let barsInMarket = 0;
  const counts = { tp1: 0, tp2: 0, sl: 0, early: 0 };

  type Pos = { entry: number; entryTime: Date; sl: number; tp1: number; tp2: number; weight: number; realized: number; tp1Done: boolean };
  let pos: Pos | null = null;

  const closeTrade = (p: Pos, time: Date, kind: ExitKind) => {
    const net = p.realized - 2 * fee; // entry side + all scale-out sides sum to 1.0 notional each
    equity *= 1 + net;
    trades.push({ entry: p.entry, entryTime: p.entryTime, exitTime: time, retPct: net, kind });
  };

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const f = eF[i]!, m = eM[i]!, s = eS[i]!;
    const fPrev = eF[i - 1]!, mPrev = eM[i - 1]!;
    if ([f, m, s, fPrev, mPrev].some((v) => !isFinite(v))) continue;

    // ---------- manage open position ----------
    if (pos) {
      barsInMarket++;
      const entry = pos.entry;
      // 1) stop loss (conservative: checked before TP)
      if (c.low <= pos.sl) {
        pos.realized += pos.weight * ((pos.sl - entry) / entry);
        if (pos.tp1Done) counts.sl++; else counts.sl++;
        closeTrade(pos, c.openTime, pos.tp1Done ? 'tp1+sl' : 'sl');
        pos = null;
        continue;
      }
      // 2) take-profit ladder
      if (!pos.tp1Done && c.high >= pos.tp1) {
        pos.realized += 0.5 * ((pos.tp1 - entry) / entry);
        pos.weight = 0.5;
        pos.tp1Done = true;
        counts.tp1++;
        if (c.high >= pos.tp2) {
          pos.realized += 0.5 * ((pos.tp2 - entry) / entry);
          counts.tp2++;
          closeTrade(pos, c.openTime, 'tp2');
          pos = null;
          continue;
        }
      } else if (pos.tp1Done && c.high >= pos.tp2) {
        pos.realized += pos.weight * ((pos.tp2 - entry) / entry);
        counts.tp2++;
        closeTrade(pos, c.openTime, 'tp2');
        pos = null;
        continue;
      }
      // 3) early exit on close
      if (c.close < m || f < m) {
        pos.realized += pos.weight * ((c.close - entry) / entry);
        counts.early++;
        closeTrade(pos, c.openTime, pos.tp1Done ? 'tp1+early' : 'early');
        pos = null;
      }
      continue; // one action stream per bar; never enter while/just-managed
    }

    // ---------- look for entry ----------
    const trendOk = f > m && m > s && f > fPrev && m > mPrev && c.close > s;
    if (!trendOk) continue;

    // pullback candle = previous bar; confirmation = this bar
    const pullback = prev.low <= fPrev && prev.close >= mPrev;
    const confirm = c.close > c.open && c.close > f;
    const near = Math.abs(c.close - f) / f <= nearPct;
    if (!(pullback && confirm && near)) continue;

    const entry = c.close;
    const sl = Math.min(prev.low, m) * (1 - slBuf);
    if (entry <= sl) continue;
    const risk = entry - sl;
    pos = { entry, entryTime: c.openTime, sl, tp1: entry + tp1R * risk, tp2: entry + tp2R * risk, weight: 1, realized: 0, tp1Done: false };
  }

  if (pos) {
    const last = candles[candles.length - 1]!.close;
    pos.realized += pos.weight * ((last - pos.entry) / pos.entry);
    closeTrade(pos, candles[candles.length - 1]!.openTime, pos.tp1Done ? 'tp1+early' : 'early');
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  const exposure = candles.length > warmup ? barsInMarket / (candles.length - warmup) : 0;

  return {
    trades: trades.length,
    wins,
    counts,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    exposure: exposure * 100,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, emaArg, nearArg, tp1Arg, tp2Arg, slArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '30m';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const periods = ((emaArg ?? '34,89,200').split(',').map(Number) as number[]).slice(0, 3) as [number, number, number];
  const nearPct = Number(nearArg ?? 1.5) / 100;
  const tp1R = Number(tp1Arg ?? 1.5);
  const tp2R = Number(tp2Arg ?? 3);
  const slBuf = Number(slArg ?? 0.1) / 100;

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  console.log(`\n=== EMA PULLBACK PRO ${periods.join('/')} | ${interval} ${days}d | near<=${(nearPct * 100).toFixed(2)}% | TP ${tp1R}R/${tp2R}R 50/50 | SL min(low,EMA89)-${(slBuf * 100).toFixed(2)}% | fee ${feePerSide}%/side ===`);
  console.log('symbol     | trades | tp1 | tp2 | sl | early | winRate |   final$   | return% | maxDD% | expo%');
  for (const symbol of symbols) {
    const candles = await fetchKlines(symbol, interval, startMs, endMs);
    if (candles.length === 0) { console.log(`${symbol.padEnd(10)} | no data`); continue; }
    const r = runPro(candles, periods, nearPct, tp1R, tp2R, slBuf, capital, feePerSide);
    console.log(
      `${symbol.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.counts.tp1).padStart(3)} | ${String(r.counts.tp2).padStart(3)} | ${String(r.counts.sl).padStart(2)} | ${String(r.counts.early).padStart(5)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${fmt(r.exposure).padStart(5)}`
    );
    if (symbols.length === 1 && r.list.length) {
      console.log(`\nlast 10 trades:`);
      console.log('  entry time          entry       ret%   kind');
      for (const t of r.list.slice(-10)) {
        console.log(`  ${t.entryTime.toISOString().slice(0, 16).replace('T', ' ')}  ${fmt(t.entry).padStart(9)}  ${((t.retPct * 100 >= 0 ? '+' : '') + fmt(t.retPct * 100)).padStart(6)}  ${t.kind}`);
      }
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
