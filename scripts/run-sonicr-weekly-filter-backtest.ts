/**
 * SonicR System + WEEKLY trend filter.
 *
 * Same SonicR engine as scripts/run-sonicr-backtest.ts (Dragon EMA34 high/low/close band,
 * EMA89/200 trend, pullback-into-Dragon entry, TP at swing high + Dragon trail), with one
 * extra gate:
 *
 *   WEEKLY FILTER — only take LONGs when the WEEKLY trend is up, SHORTs when down.
 *     weeklyUp   = weeklyClose > weeklyEMA(W)  AND  weeklyEMA rising
 *     weeklyDown = weeklyClose < weeklyEMA(W)  AND  weeklyEMA falling
 *   The weekly state used for a trading candle is taken from the most recent weekly bar
 *   that has already CLOSED at/before that candle's open time (no look-ahead).
 *
 * Goal: exclude the choppy/down regimes (e.g. XRP) where the intraday trend filter keeps
 * allowing trades against the bigger picture.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-sonicr-weekly-filter-backtest.ts \
 *     [symbols] [interval] [days] [capital] [feePctPerSide] [pivotK] [swingLookback] [slBufPct] [weeklyEmaPeriod]
 *   e.g. ... "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT" 1d 730 1000 0.05 3 60 0.1 20
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: Date; closeTime: number };

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
        closeTime: k[6] as number,
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

function emaSeries(values: number[], period: number): number[] {
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

// Precompute weekly trend states as [closeTimeMs, 'up'|'down'|'flat'].
function weeklyStates(weekly: Candle[], wPeriod: number): { t: number; s: 'up' | 'down' | 'flat' }[] {
  const wc = weekly.map((c) => c.close);
  const we = emaSeries(wc, wPeriod);
  const out: { t: number; s: 'up' | 'down' | 'flat' }[] = [];
  for (let i = 0; i < weekly.length; i++) {
    let s: 'up' | 'down' | 'flat' = 'flat';
    if (isFinite(we[i]!) && isFinite(we[i - 1]!)) {
      if (wc[i]! > we[i]! && we[i]! > we[i - 1]!) s = 'up';
      else if (wc[i]! < we[i]! && we[i]! < we[i - 1]!) s = 'down';
    }
    out.push({ t: weekly[i]!.closeTime, s });
  }
  return out;
}

type ExitKind = 'tp1+trail' | 'tp1+sl' | 'trail' | 'sl';
type Trade = { dir: 'long' | 'short'; entry: number; entryTime: Date; exitTime: Date; retPct: number; kind: ExitKind };

function runSonicRWeekly(
  candles: Candle[],
  wkStates: { t: number; s: 'up' | 'down' | 'flat' }[],
  pivotK: number,
  swingLookback: number,
  slBuf: number,
  capital: number,
  feePerSide: number,
) {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const dTop = emaSeries(highs, 34);
  const dMid = emaSeries(closes, 34);
  const dBot = emaSeries(lows, 34);
  const e89 = emaSeries(closes, 89);
  const e200 = emaSeries(closes, 200);
  const fee = feePerSide / 100;
  const warmup = 200 + 1;

  // weekly trend lookup for a candle open time (last weekly bar closed at/before it)
  let wkIdx = 0;
  const weeklyAt = (openMs: number): 'up' | 'down' | 'flat' => {
    while (wkIdx + 1 < wkStates.length && wkStates[wkIdx + 1]!.t <= openMs) wkIdx++;
    if (wkStates.length === 0 || wkStates[wkIdx]!.t > openMs) return 'flat';
    return wkStates[wkIdx]!.s;
  };

  const isPivotHigh = (j: number) => {
    if (j - pivotK < 0 || j + pivotK >= candles.length) return false;
    for (let x = j - pivotK; x <= j + pivotK; x++) if (highs[x]! > highs[j]!) return false;
    return true;
  };
  const isPivotLow = (j: number) => {
    if (j - pivotK < 0 || j + pivotK >= candles.length) return false;
    for (let x = j - pivotK; x <= j + pivotK; x++) if (lows[x]! < lows[j]!) return false;
    return true;
  };
  const nearestSwingHighAbove = (i: number, price: number): number | null => {
    let best: number | null = null;
    for (let j = i - pivotK - 1; j >= Math.max(0, i - swingLookback); j--) {
      if (j + pivotK >= i) continue;
      if (isPivotHigh(j) && highs[j]! > price && (best === null || highs[j]! < best)) best = highs[j]!;
    }
    return best;
  };
  const nearestSwingLowBelow = (i: number, price: number): number | null => {
    let best: number | null = null;
    for (let j = i - pivotK - 1; j >= Math.max(0, i - swingLookback); j--) {
      if (j + pivotK >= i) continue;
      if (isPivotLow(j) && lows[j]! < price && (best === null || lows[j]! > best)) best = lows[j]!;
    }
    return best;
  };

  const trades: Trade[] = [];
  let equity = capital;
  let barsInMarket = 0;
  const counts = { tp1: 0, trail: 0, sl: 0 };

  type Pos = { dir: 'long' | 'short'; entry: number; entryTime: Date; sl: number; target: number | null; weight: number; realized: number; tp1Done: boolean };
  let pos: Pos | null = null;
  const closeTrade = (p: Pos, time: Date, kind: ExitKind) => {
    const net = p.realized - 2 * fee;
    equity *= 1 + net;
    trades.push({ dir: p.dir, entry: p.entry, entryTime: p.entryTime, exitTime: time, retPct: net, kind });
  };

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const dt = dTop[i]!, dm = dMid[i]!, db = dBot[i]!;
    const dmPrev = dMid[i - 1]!, dtPrev = dTop[i - 1]!;
    const t89 = e89[i]!, t200 = e200[i]!;
    if ([dt, dm, db, dmPrev, t89, t200].some((v) => !isFinite(v))) continue;

    if (pos) {
      barsInMarket++;
      const entry = pos.entry;
      if (pos.dir === 'long') {
        if (c.low <= pos.sl) { pos.realized += pos.weight * ((pos.sl - entry) / entry); counts.sl++; closeTrade(pos, c.openTime, pos.tp1Done ? 'tp1+sl' : 'sl'); pos = null; continue; }
        if (!pos.tp1Done && pos.target !== null && c.high >= pos.target) { pos.realized += 0.5 * ((pos.target - entry) / entry); pos.weight = 0.5; pos.tp1Done = true; counts.tp1++; }
        if (c.close < db) { pos.realized += pos.weight * ((c.close - entry) / entry); counts.trail++; closeTrade(pos, c.openTime, pos.tp1Done ? 'tp1+trail' : 'trail'); pos = null; continue; }
      } else {
        if (c.high >= pos.sl) { pos.realized += pos.weight * ((entry - pos.sl) / entry); counts.sl++; closeTrade(pos, c.openTime, pos.tp1Done ? 'tp1+sl' : 'sl'); pos = null; continue; }
        if (!pos.tp1Done && pos.target !== null && c.low <= pos.target) { pos.realized += 0.5 * ((entry - pos.target) / entry); pos.weight = 0.5; pos.tp1Done = true; counts.tp1++; }
        if (c.close > dt) { pos.realized += pos.weight * ((entry - c.close) / entry); counts.trail++; closeTrade(pos, c.openTime, pos.tp1Done ? 'tp1+trail' : 'trail'); pos = null; continue; }
      }
      continue;
    }

    const wk = weeklyAt(c.openTime.getTime());
    const upTrend = wk === 'up' && dm > t89 && t89 > t200 && dm > dmPrev && c.close > t89;
    const downTrend = wk === 'down' && dm < t89 && t89 < t200 && dm < dmPrev && c.close < t89;

    if (upTrend) {
      const touched = c.low <= dt || prev.low <= dtPrev;
      const confirm = c.close > c.open && c.close > dt;
      if (touched && confirm) {
        const entry = c.close;
        const sl = Math.min(Math.min(c.low, prev.low), db) * (1 - slBuf);
        if (entry > sl) pos = { dir: 'long', entry, entryTime: c.openTime, sl, target: nearestSwingHighAbove(i, entry), weight: 1, realized: 0, tp1Done: false };
      }
    } else if (downTrend) {
      const touched = c.high >= db || prev.high >= dBot[i - 1]!;
      const confirm = c.close < c.open && c.close < db;
      if (touched && confirm) {
        const entry = c.close;
        const sl = Math.max(Math.max(c.high, prev.high), dt) * (1 + slBuf);
        if (sl > entry) pos = { dir: 'short', entry, entryTime: c.openTime, sl, target: nearestSwingLowBelow(i, entry), weight: 1, realized: 0, tp1Done: false };
      }
    }
  }

  if (pos) {
    const last = candles[candles.length - 1]!.close;
    pos.realized += pos.weight * (pos.dir === 'long' ? (last - pos.entry) / pos.entry : (pos.entry - last) / pos.entry);
    closeTrade(pos, candles[candles.length - 1]!.openTime, pos.tp1Done ? 'tp1+trail' : 'trail');
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  const longs = trades.filter((t) => t.dir === 'long').length;
  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  const exposure = candles.length > warmup ? barsInMarket / (candles.length - warmup) : 0;
  return { trades: trades.length, longs, wins, counts, winRate: trades.length ? wins / trades.length : 0, finalEquity: equity, returnPct: (equity / capital - 1) * 100, maxDD: maxDD * 100, exposure: exposure * 100 };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, kArg, lookArg, slArg, wkArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '1d';
  const days = Number(daysArg ?? 730);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const pivotK = Number(kArg ?? 3);
  const swingLookback = Number(lookArg ?? 60);
  const slBuf = Number(slArg ?? 0.1) / 100;
  const wPeriod = Number(wkArg ?? 20);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  const weeklyStartMs = startMs - 400 * 24 * 60 * 60 * 1000; // extra history for weekly EMA warmup

  console.log(`\n=== SonicR + WEEKLY filter (weeklyEMA${wPeriod}) | ${interval} ${days}d | pivotK=${pivotK} lookback=${swingLookback} | SL buf ${(slBuf * 100).toFixed(2)}% | fee ${feePerSide}%/side ===`);
  console.log('symbol     | trades | long | tp1 | trail | sl | winRate |   final$   | return% | maxDD% | expo%');
  const rows: { symbol: string; r: ReturnType<typeof runSonicRWeekly> }[] = [];
  for (const symbol of symbols) {
    const [candles, weekly] = await Promise.all([
      fetchKlines(symbol, interval, startMs, endMs),
      fetchKlines(symbol, '1w', weeklyStartMs, endMs),
    ]);
    if (candles.length === 0) { console.log(`${symbol.padEnd(10)} | no data`); continue; }
    const wk = weeklyStates(weekly, wPeriod);
    const r = runSonicRWeekly(candles, wk, pivotK, swingLookback, slBuf, capital, feePerSide);
    rows.push({ symbol, r });
    console.log(
      `${symbol.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.longs).padStart(4)} | ${String(r.counts.tp1).padStart(3)} | ${String(r.counts.trail).padStart(5)} | ${String(r.counts.sl).padStart(2)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${fmt(r.exposure).padStart(5)}`
    );
  }
  if (rows.length > 1) {
    const avg = rows.reduce((a, x) => a + x.r.returnPct, 0) / rows.length;
    console.log(`           | basket avg return ${(avg >= 0 ? '+' : '') + fmt(avg)}%`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
