/**
 * Backtest UTBot as a LONG-ONLY SPOT signal on a higher timeframe.
 *
 * Use case: the user buys spot ("mua lướt") off this radar, so no shorting — the strategy
 * is in the market only while UTBot says bull, and sits in CASH during bear.
 *
 *   - UTBot trailing stop on CLOSED candles (same formula as the live swing flow), ATR(10).
 *   - trend = close > stop ? bull : bear.
 *   - On a confirmed flip to BULL  → BUY at that candle's close (if in cash).
 *   - On a confirmed flip to BEAR  → SELL at that candle's close (go to cash). No short.
 *   - Final open long marked-to-market at the last close.
 *   - $1000 compounded, no leverage. Fee on BOTH sides (buy + sell = 2×feePerSide per trade).
 *   - Compared against buy & hold over the same window.
 *
 * Both entry and exit act on the candle CLOSE — appropriate for a higher-timeframe spot signal.
 * Results exclude slippage/funding (spot has no funding).
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-utbot-spot-backtest.ts [symbol] [interval] [days] [capital] [feePctPerSide] [kvList]
 *   e.g. ... ETHUSDT 1d 1500 1000 0.05 "1,2,3,4"
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;

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

type Trade = { entry: number; exit: number; entryTime: Date; exitTime: Date; retPct: number; bars: number; open: boolean };

function runSpotLong(candles: Candle[], keyValue: number, capital: number, feePerSide: number) {
  const stop = utBotStops(candles, ATR_PERIOD, keyValue);
  const fee = feePerSide / 100;

  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < ATR_PERIOD || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };

  const trades: Trade[] = [];
  let equity = capital;
  let pos: { entry: number; entryTime: Date; entryIdx: number } | null = null;
  let prevTrend: 'bull' | 'bear' | null = null;

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const close = candles[i]!.close;

    if (prevTrend === null) {
      // First defined trend: if bull, buy now; if bear, stay in cash.
      if (t === 'bull') pos = { entry: close, entryTime: candles[i]!.openTime, entryIdx: i };
      prevTrend = t;
      continue;
    }

    if (t !== prevTrend) {
      if (t === 'bear' && pos) {
        // flip to bear → sell to cash
        const net = (close - pos.entry) / pos.entry - 2 * fee;
        equity *= 1 + net;
        trades.push({ entry: pos.entry, exit: close, entryTime: pos.entryTime, exitTime: candles[i]!.openTime, retPct: net * 100, bars: i - pos.entryIdx, open: false });
        pos = null;
      } else if (t === 'bull' && !pos) {
        // flip to bull → buy
        pos = { entry: close, entryTime: candles[i]!.openTime, entryIdx: i };
      }
      prevTrend = t;
    }
  }

  if (pos) {
    const i = candles.length - 1;
    const last = candles[i]!.close;
    const net = (last - pos.entry) / pos.entry - 2 * fee;
    equity *= 1 + net;
    trades.push({ entry: pos.entry, exit: last, entryTime: pos.entryTime, exitTime: candles[i]!.openTime, retPct: net * 100, bars: i - pos.entryIdx, open: true });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct / 100;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  const barsIn = trades.reduce((a, t) => a + t.bars, 0);

  return {
    keyValue,
    trades: trades.length,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    barsIn,
    list: trades,
  };
}

async function runOne(symbol: string, interval: string, startMs: number, endMs: number, capital: number, feePerSide: number, kvList: number[]) {
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  if (candles.length < ATR_PERIOD + 5) return null;
  const bhEntry = candles[ATR_PERIOD]!.close;
  const bhExit = candles[candles.length - 1]!.close;
  const bhRet = ((bhExit - bhEntry) / bhEntry) * 100;
  const results = kvList.map((kv) => runSpotLong(candles, kv, capital, feePerSide));
  const best = results.reduce((a, b) => (b.finalEquity > a.finalEquity ? b : a));
  return { candles, bhRet, results, best };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, kvArg] = process.argv;
  const symbols = (symArg ?? 'ETHUSDT').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const interval = intArg ?? '1d';
  const days = Number(daysArg ?? 1500);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const kvList = (kvArg ?? '1,2,3,4').split(',').map(Number);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  // ── Multi-symbol compact mode: one row per coin (kv2 primary + best-kv ref). ──
  if (symbols.length > 1) {
    const PRIMARY_KV = kvList.includes(2) ? 2 : kvList[0]!;
    console.log(`\n${'='.repeat(96)}`);
    console.log(`UTBOT LONG-ONLY SPOT BASKET | ${interval} | ATR(${ATR_PERIOD}) | $${capital} compounded | fee ${feePerSide}%/side | up to ${days}d`);
    console.log(`Primary keyValue=${PRIMARY_KV} (chosen on ETH); "best kv" column sweeps ${kvList.join('/')} per coin (in-sample, reference only).`);
    console.log(`${'-'.repeat(96)}`);
    console.log(`${'Symbol'.padEnd(9)}${'cndls'.padStart(6)}${'B&H%'.padStart(10)}${('kv'+PRIMARY_KV+' ret%').padStart(11)}${'win%'.padStart(7)}${'trd'.padStart(5)}${'DD%'.padStart(7)}${'  | bestKv'.padEnd(9)}${'ret%'.padStart(11)}${'  edge vs B&H'.padStart(14)}`);

    const rows: { symbol: string; primary: ReturnType<typeof runSpotLong>; best: ReturnType<typeof runSpotLong>; bhRet: number; n: number; short: boolean }[] = [];
    for (const symbol of symbols) {
      const r = await runOne(symbol, interval, startMs, endMs, capital, feePerSide, kvList);
      if (!r) { console.log(`${symbol.replace('USDT','').padEnd(9)}  (insufficient data)`); continue; }
      const primary = r.results.find((x) => x.keyValue === PRIMARY_KV)!;
      const n = r.candles.length;
      const short = n < 2000; // H4: <2000 candles ≈ <~333d history → thin sample
      rows.push({ symbol, primary, best: r.best, bhRet: r.bhRet, n, short });
      const edge = primary.returnPct - r.bhRet;
      console.log(
        `${symbol.replace('USDT', '').padEnd(9)}${String(n).padStart(6)}${((r.bhRet >= 0 ? '+' : '') + fmt(r.bhRet)).padStart(10)}${((primary.returnPct >= 0 ? '+' : '') + fmt(primary.returnPct)).padStart(11)}${fmt(primary.winRate, 0).padStart(7)}${String(primary.trades).padStart(5)}${fmt(primary.maxDD, 0).padStart(7)}${('  | kv' + r.best.keyValue).padEnd(9)}${((r.best.returnPct >= 0 ? '+' : '') + fmt(r.best.returnPct)).padStart(11)}${((edge >= 0 ? '+' : '') + fmt(edge) + '%').padStart(14)}${short ? '  ⚠short' : ''}`,
      );
    }

    // Aggregate (full-history coins only, exclude thin samples from the headline stat)
    const solid = rows.filter((r) => !r.short);
    const beatBH = solid.filter((r) => r.primary.returnPct > r.bhRet).length;
    const positive = solid.filter((r) => r.primary.returnPct > 0).length;
    const medianEdge = (() => {
      const e = solid.map((r) => r.primary.returnPct - r.bhRet).sort((a, b) => a - b);
      return e.length ? e[Math.floor(e.length / 2)]! : 0;
    })();
    console.log(`${'-'.repeat(96)}`);
    console.log(`Coins with adequate history: ${solid.length}/${rows.length}  ·  kv${PRIMARY_KV} positive: ${positive}/${solid.length}  ·  beat Buy&Hold: ${beatBH}/${solid.length}  ·  median edge vs B&H: ${(medianEdge >= 0 ? '+' : '') + fmt(medianEdge)}%`);
    console.log(`(⚠short = <2000 candles, thin sample — excluded from the aggregate.)`);
    return;
  }

  const symbol = symbols[0]!;
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  if (candles.length < ATR_PERIOD + 5) {
    console.log(`${symbol} ${interval}: not enough candles (${candles.length})`);
    return;
  }

  const bhEntry = candles[ATR_PERIOD]!.close;
  const bhExit = candles[candles.length - 1]!.close;
  const bhRet = ((bhExit - bhEntry) / bhEntry) * 100;

  console.log(`\n${'='.repeat(76)}`);
  console.log(`UTBOT LONG-ONLY SPOT | ${symbol} ${interval} | ATR(${ATR_PERIOD}) | $${capital} compounded | fee ${feePerSide}%/side`);
  console.log(`${candles.length} candles  ${candles[0]!.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]!.openTime.toISOString().slice(0, 10)}`);
  console.log(`Buy & Hold: ${bhRet >= 0 ? '+' : ''}${fmt(bhRet)}%   ($${fmt(capital * (1 + bhRet / 100))})`);
  console.log(`${'-'.repeat(76)}`);
  console.log(`${'kv'.padEnd(4)}${'trades'.padStart(8)}${'win%'.padStart(8)}${'return%'.padStart(11)}${'final$'.padStart(13)}${'maxDD%'.padStart(9)}${'barsIn'.padStart(8)}`);

  let best: ReturnType<typeof runSpotLong> | null = null;
  for (const kv of kvList) {
    const r = runSpotLong(candles, kv, capital, feePerSide);
    console.log(
      `${String(kv).padEnd(4)}${String(r.trades).padStart(8)}${fmt(r.winRate, 1).padStart(8)}${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(11)}${('$' + fmt(r.finalEquity)).padStart(13)}${fmt(r.maxDD, 1).padStart(9)}${String(r.barsIn).padStart(8)}`,
    );
    if (!best || r.finalEquity > best.finalEquity) best = r;
  }
  if (best) {
    console.log(`\nBest kv=${best.keyValue}: $${fmt(best.finalEquity)} (${(best.returnPct >= 0 ? '+' : '') + fmt(best.returnPct)}%), ${best.trades} trades. Last 6:`);
    for (const t of best.list.slice(-6)) {
      console.log(`  ${t.entryTime.toISOString().slice(0, 10)} → ${t.exitTime.toISOString().slice(0, 10)}  entry ${fmt(t.entry).padStart(9)}  exit ${fmt(t.exit).padStart(9)}  ${(t.retPct >= 0 ? '+' : '') + fmt(t.retPct)}%${t.open ? ' (open)' : ''}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
