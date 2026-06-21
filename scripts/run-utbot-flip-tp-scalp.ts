/**
 * UTBot trend-flip entry with a fixed TP, enter ONLY on the flip (user's exact spec):
 *
 *   - UTBot trailing stop (Wilder ATR). trend = close > stop ? bull : bear, on CANDLE CLOSE.
 *   - On a confirmed flip:
 *       bear -> bull  => enter LONG  at that candle's close
 *       bull -> bear  => enter SHORT at that candle's close
 *   - Take-profit = tpPct (default 5%) from entry, checked intra-candle.
 *   - Force close on the NEXT trend flip (the flip both closes the current trade AND opens
 *     the opposite one — that opposite open is the "enter on break").
 *   - Enter ONLY at a flip. If TP is hit before the next flip, go FLAT and wait for the
 *     next flip (do NOT re-enter in between).
 *   - One position at a time, $capital compounded, no leverage. Fee per side both ways.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-utbot-flip-tp-scalp.ts \
 *     [symbol] [interval] [days] [capital] [feePctPerSide] [kvList] [tpPct] [atrPeriod]
 *   e.g. ... BTCUSDT 5m 90 1000 0.05 "1,2,3,4" 5 10
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

function wilderAtr(c: Candle[], period: number): number[] {
  const n = c.length;
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close))));
  const atr = new Array(n).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  return atr;
}

function utBotStops(c: Candle[], period: number, keyValue: number): number[] {
  const atr = wilderAtr(c, period);
  const stop = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const nLoss = keyValue * atr[i]!;
    const close = c[i]!.close;
    const prevC = c[i - 1]!.close;
    const prev = stop[i - 1]!;
    if (close > prev && prevC > prev) stop[i] = Math.max(prev, close - nLoss);
    else if (close < prev && prevC < prev) stop[i] = Math.min(prev, close + nLoss);
    else if (close > prev) stop[i] = close - nLoss;
    else stop[i] = close + nLoss;
  }
  return stop;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Trade = { dir: 'long' | 'short'; entry: number; exit: number; entryTime: Date; exitTime: Date; reason: 'tp' | 'flip' | 'eod'; retPct: number };

function run(candles: Candle[], keyValue: number, atrPeriod: number, tpPct: number, capital: number, feePerSide: number) {
  const stop = utBotStops(candles, atrPeriod, keyValue);
  const fee = feePerSide / 100;
  const tp = tpPct / 100;

  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < atrPeriod || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };

  const trades: Trade[] = [];
  let equity = capital;
  let pos: { dir: 'long' | 'short'; entry: number; entryTime: Date; tpPrice: number } | null = null;
  let prevTrend: 'bull' | 'bear' | null = null;

  const closeTrade = (exit: number, exitTime: Date, reason: Trade['reason']) => {
    const gross = pos!.dir === 'long' ? (exit - pos!.entry) / pos!.entry : (pos!.entry - exit) / pos!.entry;
    const net = gross - 2 * fee;
    equity *= 1 + net;
    trades.push({ dir: pos!.dir, entry: pos!.entry, exit, entryTime: pos!.entryTime, exitTime, reason, retPct: net });
    pos = null;
  };

  for (let i = atrPeriod; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const c = candles[i]!;

    // 1. TP check intra-candle (before the close-based flip).
    if (pos) {
      if (pos.dir === 'long' && c.high >= pos.tpPrice) closeTrade(pos.tpPrice, c.openTime, 'tp');
      else if (pos.dir === 'short' && c.low <= pos.tpPrice) closeTrade(pos.tpPrice, c.openTime, 'tp');
    }

    const flipped = prevTrend !== null && t !== prevTrend;

    // 2. Force close on flip.
    if (pos && flipped) closeTrade(c.close, c.openTime, 'flip');

    // 3. Enter ONLY on a flip (or the very first defined trend), in the new trend direction.
    if ((flipped || prevTrend === null) && !pos) {
      const dir = t === 'bull' ? 'long' : 'short';
      const tpPrice = dir === 'long' ? c.close * (1 + tp) : c.close * (1 - tp);
      pos = { dir, entry: c.close, entryTime: c.openTime, tpPrice };
    }

    prevTrend = t;
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
    keyValue,
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
  const [, , symArg, intArg, daysArg, capArg, feeArg, kvArg, tpArg, atrArg] = process.argv;
  const symbol = (symArg ?? 'BTCUSDT').toUpperCase();
  const interval = intArg ?? '5m';
  const days = Number(daysArg ?? 90);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const kvList = (kvArg ?? '1,2,3,4').split(',').map(Number);
  const tpPct = Number(tpArg ?? 5);
  const atrPeriod = Number(atrArg ?? 10);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${symbol} ${interval} (${days}d)...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`);

  console.log(`\n=== UTBot FLIP-ENTRY + TP${tpPct}% (enter on flip only) | ${symbol} ${interval} | ${days}d | ATR(${atrPeriod}) | $${capital} compounding | fee ${feePerSide}%/side ===`);
  console.log('keyValue | trades | winRate |   final$   | return% | maxDD% | TP/flip/eod');
  let best: ReturnType<typeof run> | null = null;
  for (const kv of kvList) {
    const r = run(candles, kv, atrPeriod, tpPct, capital, feePerSide);
    const byReason = (rs: Trade['reason']) => r.list.filter((t) => t.reason === rs).length;
    console.log(
      `   ${String(kv).padEnd(5)} | ${String(r.trades).padStart(6)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${byReason('tp')}/${byReason('flip')}/${byReason('eod')}`
    );
    if (!best || r.finalEquity > best.finalEquity) best = r;
  }

  if (best && best.list.length) {
    console.log(`\nBest: keyValue=${best.keyValue} → $${fmt(best.finalEquity)} (${(best.returnPct >= 0 ? '+' : '') + fmt(best.returnPct)}%). Last 8 trades:`);
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
