/**
 * Backtest UTBot LONG-ONLY SPOT on H4, GATED by the weekly (W1) UTBot trend.
 *
 * Idea: the plain-H4 test whipsawed out of strong uptrends and traded too much in bear
 * markets. Here we only allow longs while the WEEKLY UTBot trend is bull.
 *
 *   - Compute UTBot trend on both W1 and H4 closes (same ATR(10) formula, same keyValue).
 *   - Long-only, in cash otherwise.
 *   - ENTER (at H4 close) when: flat AND H4 trend == bull AND weekly trend == bull.
 *   - EXIT  (at H4 close) when: in position AND (H4 flips bear OR weekly turns bear).
 *   - Weekly trend "as of" an H4 candle = the latest weekly bar that has CLOSED at/before
 *     that H4 time (no lookahead).
 *   - $1000 compounded, fee on both sides. Compared vs buy & hold.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-utbot-h4-w1filter-backtest.ts [symbols] [days] [capital] [feePctPerSide] [kvList]
 *   e.g. ... "ETHUSDT,SOLUSDT" 1500 1000 0.05 "1,2,3,4"
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: number };

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
        openTime: k[0] as number,
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
  if (n < period) return atr;
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

// Per-candle trend (bull/bear/null-while-warming) from UTBot stops.
function trendSeries(c: Candle[], keyValue: number): ('bull' | 'bear' | null)[] {
  const stop = utBotStops(c, ATR_PERIOD, keyValue);
  return c.map((x, i) => (i < ATR_PERIOD || stop[i] === 0 ? null : x.close > stop[i]! ? 'bull' : 'bear'));
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Trade = { entry: number; exit: number; retPct: number; bars: number; open: boolean };

function runGated(h4: Candle[], wk: Candle[], keyValue: number, capital: number, feePerSide: number) {
  const fee = feePerSide / 100;
  const h4Trend = trendSeries(h4, keyValue);
  const wkTrend = trendSeries(wk, keyValue);
  // weekly close time = openTime + 1 week; trend is known only after the bar closes.
  const wkCloseAndTrend = wk
    .map((w, i) => ({ closeMs: w.openTime + WEEK_MS, trend: wkTrend[i] }))
    .filter((x) => x.trend !== null) as { closeMs: number; trend: 'bull' | 'bear' }[];

  // latest weekly trend whose close <= t (no lookahead)
  let wkCursor = 0;
  const weeklyTrendAt = (t: number): 'bull' | 'bear' | null => {
    while (wkCursor + 1 < wkCloseAndTrend.length && wkCloseAndTrend[wkCursor + 1]!.closeMs <= t) wkCursor++;
    const cur = wkCloseAndTrend[wkCursor];
    if (!cur || cur.closeMs > t) return null;
    return cur.trend;
  };

  const trades: Trade[] = [];
  let equity = capital;
  let pos: { entry: number; idx: number } | null = null;

  for (let i = ATR_PERIOD; i < h4.length; i++) {
    const ht = h4Trend[i];
    if (ht === null) continue;
    const wt = weeklyTrendAt(h4[i]!.openTime);
    const close = h4[i]!.close;

    if (!pos) {
      if (ht === 'bull' && wt === 'bull') pos = { entry: close, idx: i };
    } else {
      if (ht === 'bear' || wt !== 'bull') {
        const net = (close - pos.entry) / pos.entry - 2 * fee;
        equity *= 1 + net;
        trades.push({ entry: pos.entry, exit: close, retPct: net * 100, bars: i - pos.idx, open: false });
        pos = null;
      }
    }
  }
  if (pos) {
    const i = h4.length - 1;
    const last = h4[i]!.close;
    const net = (last - pos.entry) / pos.entry - 2 * fee;
    equity *= 1 + net;
    trades.push({ entry: pos.entry, exit: last, retPct: net * 100, bars: i - pos.idx, open: true });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct / 100;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return {
    keyValue,
    trades: trades.length,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
  };
}

async function main() {
  const [, , symArg, daysArg, capArg, feeArg, kvArg] = process.argv;
  const symbols = (symArg ?? 'ETHUSDT').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const days = Number(daysArg ?? 1500);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const kvList = (kvArg ?? '1,2,3,4').split(',').map(Number);

  const endMs = Date.now();
  const h4Start = endMs - days * 24 * 60 * 60 * 1000;
  const wkStart = endMs - (days + 365 * 3) * 24 * 60 * 60 * 1000; // extra history so weekly ATR is warm

  const PRIMARY_KV = kvList.includes(2) ? 2 : kvList[0]!;
  console.log(`\n${'='.repeat(98)}`);
  console.log(`UTBOT H4 LONG-ONLY + W1-BULL FILTER | ATR(${ATR_PERIOD}) | $${capital} compounded | fee ${feePerSide}%/side | up to ${days}d`);
  console.log(`Long only while weekly UTBot is bull. Primary kv=${PRIMARY_KV}; "best kv" sweeps ${kvList.join('/')} (in-sample ref).`);
  console.log(`${'-'.repeat(98)}`);
  console.log(`${'Symbol'.padEnd(9)}${'h4cndl'.padStart(7)}${'B&H%'.padStart(10)}${('kv'+PRIMARY_KV+' ret%').padStart(11)}${'win%'.padStart(7)}${'trd'.padStart(5)}${'DD%'.padStart(7)}${'  | bestKv'.padEnd(9)}${'ret%'.padStart(11)}${'  edge'.padStart(11)}`);

  const rows: { primary: ReturnType<typeof runGated>; best: ReturnType<typeof runGated>; bhRet: number; short: boolean }[] = [];
  for (const symbol of symbols) {
    const h4 = await fetchKlines(symbol, '4h', h4Start, endMs);
    const wk = await fetchKlines(symbol, '1w', wkStart, endMs);
    if (h4.length < ATR_PERIOD + 5 || wk.length < ATR_PERIOD + 2) { console.log(`${symbol.replace('USDT','').padEnd(9)}  (insufficient data)`); continue; }
    const bhRet = ((h4[h4.length - 1]!.close - h4[ATR_PERIOD]!.close) / h4[ATR_PERIOD]!.close) * 100;
    const results = kvList.map((kv) => runGated(h4, wk, kv, capital, feePerSide));
    const primary = results.find((r) => r.keyValue === PRIMARY_KV)!;
    const best = results.reduce((a, b) => (b.finalEquity > a.finalEquity ? b : a));
    const short = h4.length < 2000;
    rows.push({ primary, best, bhRet, short });
    const edge = primary.returnPct - bhRet;
    console.log(
      `${symbol.replace('USDT', '').padEnd(9)}${String(h4.length).padStart(7)}${((bhRet >= 0 ? '+' : '') + fmt(bhRet)).padStart(10)}${((primary.returnPct >= 0 ? '+' : '') + fmt(primary.returnPct)).padStart(11)}${fmt(primary.winRate, 0).padStart(7)}${String(primary.trades).padStart(5)}${fmt(primary.maxDD, 0).padStart(7)}${('  | kv' + best.keyValue).padEnd(9)}${((best.returnPct >= 0 ? '+' : '') + fmt(best.returnPct)).padStart(11)}${((edge >= 0 ? '+' : '') + fmt(edge) + '%').padStart(11)}${short ? '  ⚠short' : ''}`,
    );
  }

  const solid = rows.filter((r) => !r.short);
  const positive = solid.filter((r) => r.primary.returnPct > 0).length;
  const beatBH = solid.filter((r) => r.primary.returnPct > r.bhRet).length;
  const edges = solid.map((r) => r.primary.returnPct - r.bhRet).sort((a, b) => a - b);
  const medianEdge = edges.length ? edges[Math.floor(edges.length / 2)]! : 0;
  const avgDD = solid.length ? solid.reduce((a, r) => a + r.primary.maxDD, 0) / solid.length : 0;
  const avgWin = solid.length ? solid.reduce((a, r) => a + r.primary.winRate, 0) / solid.length : 0;
  console.log(`${'-'.repeat(98)}`);
  console.log(`Adequate history: ${solid.length}/${rows.length}  ·  kv${PRIMARY_KV} positive: ${positive}/${solid.length}  ·  beat B&H: ${beatBH}/${solid.length}  ·  median edge: ${(medianEdge >= 0 ? '+' : '') + fmt(medianEdge)}%  ·  avg win ${fmt(avgWin, 0)}%  ·  avg DD ${fmt(avgDD, 0)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
