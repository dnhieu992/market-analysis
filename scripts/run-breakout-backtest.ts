/**
 * Backtest a classic BREAKOUT strategy (strategy #3: phá vỡ kháng cự/hỗ trợ + volume).
 *
 * Rules (Donchian-style channel breakout with volume confirmation):
 *   - resistance = highest HIGH of the previous `lookback` candles
 *     support    = lowest  LOW  of the previous `lookback` candles
 *   - avgVol     = mean volume of the previous `lookback` candles
 *   - LONG  entry: candle CLOSES above resistance AND volume > volMult * avgVol
 *   - SHORT entry: candle CLOSES below support    AND volume > volMult * avgVol
 *   - Risk management: fixed stop-loss (slPct) and take-profit (tpPct) on entry price.
 *       checked intra-candle on following candles; if both SL and TP fall inside the
 *       same candle's range we assume the STOP hits first (conservative).
 *   - An opposite breakout while in a position also closes it (and flips in).
 *   - One position at a time, $capital compounded, no leverage.
 *   - Fee = feePctPerSide per side (0.05% default), charged on both open and close.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-breakout-backtest.ts \
 *     [symbol] [interval] [days] [capital] [feePctPerSide] [lookbackList] [volMult] [slPct] [tpPct]
 *   e.g. ... BTCUSDT 4h 365 1000 0.05 "20,30,55" 1.5 3 6
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { open: number; high: number; low: number; close: number; volume: number; openTime: Date };

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
        volume: parseFloat(k[5] as string),
        openTime: new Date(k[0] as number),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Trade = {
  dir: 'long' | 'short';
  entry: number;
  exit: number;
  entryTime: Date;
  exitTime: Date;
  reason: 'tp' | 'sl' | 'flip' | 'eod';
  retPct: number;
};

function runBreakout(
  candles: Candle[],
  lookback: number,
  volMult: number,
  slPct: number,
  tpPct: number,
  capital: number,
  feePerSide: number,
) {
  const fee = feePerSide / 100;
  const sl = slPct / 100;
  const tp = tpPct / 100;

  const trades: Trade[] = [];
  let equity = capital;
  let pos: { dir: 'long' | 'short'; entry: number; entryTime: Date; slPrice: number; tpPrice: number } | null = null;

  const closeTrade = (exit: number, exitTime: Date, reason: Trade['reason']) => {
    const gross = pos!.dir === 'long' ? (exit - pos!.entry) / pos!.entry : (pos!.entry - exit) / pos!.entry;
    const net = gross - 2 * fee; // open + close
    equity *= 1 + net;
    trades.push({ dir: pos!.dir, entry: pos!.entry, exit, entryTime: pos!.entryTime, exitTime, reason, retPct: net });
    pos = null;
  };

  for (let i = lookback; i < candles.length; i++) {
    const c = candles[i]!;

    // window = previous `lookback` candles [i-lookback .. i-1]
    let resistance = -Infinity;
    let support = Infinity;
    let volSum = 0;
    for (let j = i - lookback; j < i; j++) {
      const w = candles[j]!;
      if (w.high > resistance) resistance = w.high;
      if (w.low < support) support = w.low;
      volSum += w.volume;
    }
    const avgVol = volSum / lookback;
    const volOk = c.volume > volMult * avgVol;
    const longBreak = c.close > resistance && volOk;
    const shortBreak = c.close < support && volOk;

    // 1. Manage open position FIRST (SL/TP checked on this candle's range).
    if (pos) {
      if (pos.dir === 'long') {
        if (c.low <= pos.slPrice) {
          closeTrade(pos.slPrice, c.openTime, 'sl');
        } else if (c.high >= pos.tpPrice) {
          closeTrade(pos.tpPrice, c.openTime, 'tp');
        } else if (shortBreak) {
          closeTrade(c.close, c.openTime, 'flip');
        }
      } else {
        if (c.high >= pos.slPrice) {
          closeTrade(pos.slPrice, c.openTime, 'sl');
        } else if (c.low <= pos.tpPrice) {
          closeTrade(pos.tpPrice, c.openTime, 'tp');
        } else if (longBreak) {
          closeTrade(c.close, c.openTime, 'flip');
        }
      }
    }

    // 2. Enter on breakout if flat.
    if (!pos) {
      if (longBreak) {
        pos = { dir: 'long', entry: c.close, entryTime: c.openTime, slPrice: c.close * (1 - sl), tpPrice: c.close * (1 + tp) };
      } else if (shortBreak) {
        pos = { dir: 'short', entry: c.close, entryTime: c.openTime, slPrice: c.close * (1 + sl), tpPrice: c.close * (1 - tp) };
      }
    }
  }

  if (pos) closeTrade(candles[candles.length - 1]!.close, candles[candles.length - 1]!.openTime, 'eod');

  const wins = trades.filter((t) => t.retPct > 0).length;
  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    lookback,
    trades: trades.length,
    wins,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, lbArg, volArg, slArg, tpArg] = process.argv;
  const symbol = symArg ?? 'BTCUSDT';
  const interval = intArg ?? '4h';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const lbList = (lbArg ?? '20,30,55').split(',').map(Number);
  const volMult = Number(volArg ?? 1.5);
  const slPct = Number(slArg ?? 3);
  const tpPct = Number(tpArg ?? 6);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${symbol} ${interval} (${days}d)...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`);

  console.log(`\n=== BREAKOUT (Donchian + volume) | ${symbol} ${interval} | $${capital} compounding | fee ${feePerSide}%/side`);
  console.log(`    volMult=${volMult}x  SL=${slPct}%  TP=${tpPct}%  (R:R = ${fmt(tpPct / slPct, 2)}) ===`);
  console.log('lookback | trades | winRate |   final$   | return% | maxDD%');
  let best: ReturnType<typeof runBreakout> | null = null;
  for (const lb of lbList) {
    const r = runBreakout(candles, lb, volMult, slPct, tpPct, capital, feePerSide);
    console.log(
      `   ${String(lb).padEnd(5)} | ${String(r.trades).padStart(6)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${(r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)}%`.padEnd(62) + ` | ${fmt(r.maxDD)}%`
    );
    if (!best || r.finalEquity > best.finalEquity) best = r;
  }

  if (best) {
    const byReason = (rs: Trade['reason']) => best!.list.filter((t) => t.reason === rs).length;
    console.log(`\nBest: lookback=${best.lookback} → $${fmt(best.finalEquity)} (${(best.returnPct >= 0 ? '+' : '') + fmt(best.returnPct)}%).`);
    console.log(`Exit breakdown: TP=${byReason('tp')}  SL=${byReason('sl')}  flip=${byReason('flip')}  eod=${byReason('eod')}`);
    console.log('Last 8 trades:');
    console.log('  entry time          dir    entry      exit       reason  ret%');
    for (const t of best.list.slice(-8)) {
      console.log(`  ${t.entryTime.toISOString().slice(0, 16).replace('T', ' ')}  ${t.dir.padEnd(5)}  ${fmt(t.entry).padStart(9)}  ${fmt(t.exit).padStart(9)}  ${t.reason.padEnd(6)}  ${(t.retPct * 100 >= 0 ? '+' : '') + fmt(t.retPct * 100)}%`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
