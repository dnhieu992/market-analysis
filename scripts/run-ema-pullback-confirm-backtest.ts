/**
 * EMA 34/89/200 pullback with a CONFIRMATION candle and fixed R:R exits.
 *
 * Rule (decided with the user):
 *   LONG:
 *     1. Trend:   a candle CLOSES above all 3 EMAs -> close > EMA34 > EMA89 > EMA200.
 *     2. Pullback: price retraces and TAPS EMA34 (low <= EMA34; the candle may even
 *                  close below it). Track the swing low = lowest low of the pullback.
 *     3. Confirm:  a GREEN candle (close > open) closes back ABOVE EMA34 -> enter at
 *                  that close.
 *     4. Stop:     the swing low of the pullback (nearest bottom).
 *     5. Target:   entry + R_MULT * (entry - stop)   (default 2R).
 *   SHORT: the mirror image (close below all 3 EMAs, tap EMA34 from below, red
 *          confirmation candle closing below EMA34, stop = swing high, target 2R down).
 *
 * One position at a time. After any exit the setup must form again from scratch
 * (fresh trend -> pullback -> confirm). $1000 compounded, fee 0.05%/side both sides.
 * If stop and target are both inside one candle's range, the STOP is assumed hit
 * first (conservative).
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema-pullback-confirm-backtest.ts \
 *     [symbols] [interval] [days] [capital] [feePctPerSide] [emaPeriods] [rMult] [nearPct]
 *   e.g. ... "BTCUSDT,ETHUSDT" 4h 365 1000 0.05 "34,89,200" 2 0
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

type Trade = { dir: 'long' | 'short'; entry: number; exit: number; entryTime: Date; exitTime: Date; retPct: number; rMultiple: number; reason: 'tp' | 'sl' };

function runConfirm(
  candles: Candle[],
  periods: [number, number, number],
  rMult: number,
  nearPct: number, // pullback proximity tolerance, fraction (0 = must touch)
  capital: number,
  feePerSide: number,
) {
  const closes = candles.map((c) => c.close);
  const [pf, pm, ps] = periods;
  const eF = ema(closes, pf);
  const eM = ema(closes, pm);
  const eS = ema(closes, ps);
  const fee = feePerSide / 100;
  const warmup = Math.max(pf, pm, ps);

  const trades: Trade[] = [];
  let equity = capital;
  let barsInMarket = 0;

  // Long-side setup state machine
  let lSaw = false;       // saw a close above all 3 EMAs
  let lPulled = false;    // saw the EMA34 tap
  let lSwingLow = Infinity;
  // Short-side
  let sSaw = false;
  let sPulled = false;
  let sSwingHigh = -Infinity;

  let pos: { dir: 'long' | 'short'; entry: number; entryTime: Date; stop: number; target: number } | null = null;

  const resetLong = () => { lSaw = false; lPulled = false; lSwingLow = Infinity; };
  const resetShort = () => { sSaw = false; sPulled = false; sSwingHigh = -Infinity; };

  const recordExit = (p: NonNullable<typeof pos>, exit: number, reason: 'tp' | 'sl', time: Date) => {
    const gross = p.dir === 'long' ? (exit - p.entry) / p.entry : (p.entry - exit) / p.entry;
    const net = gross - 2 * fee;
    equity *= 1 + net;
    const risk = Math.abs(p.entry - p.stop) / p.entry;
    trades.push({ dir: p.dir, entry: p.entry, exit, entryTime: p.entryTime, exitTime: time, retPct: net, rMultiple: risk ? gross / risk : 0, reason });
  };

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const f = eF[i]!, m = eM[i]!, s = eS[i]!;
    if (!isFinite(f) || !isFinite(m) || !isFinite(s)) continue;

    // ---- manage open position first ----
    if (pos) {
      barsInMarket++;
      if (pos.dir === 'long') {
        if (c.low <= pos.stop) { recordExit(pos, pos.stop, 'sl', c.openTime); pos = null; }
        else if (c.high >= pos.target) { recordExit(pos, pos.target, 'tp', c.openTime); pos = null; }
      } else {
        if (c.high >= pos.stop) { recordExit(pos, pos.stop, 'sl', c.openTime); pos = null; }
        else if (c.low <= pos.target) { recordExit(pos, pos.target, 'tp', c.openTime); pos = null; }
      }
      continue; // never enter and manage on the same bar
    }

    const bull = f > m && m > s;
    const bear = f < m && m < s;
    const nearF = f * (1 + nearPct); // for long, "near or below" EMA34
    const nearFLow = f * (1 - nearPct); // for short

    // ---- LONG setup ----
    if (bull) {
      if (!lSaw && c.close > f) lSaw = true;            // closed above all 3 EMAs
      if (lSaw && c.low <= nearF) { lPulled = true; lSwingLow = Math.min(lSwingLow, c.low); }
      if (lPulled && c.close > c.open && c.close > f) { // green confirmation closing back above EMA34
        const entry = c.close, stop = lSwingLow;
        if (entry > stop) {
          pos = { dir: 'long', entry, entryTime: c.openTime, stop, target: entry + rMult * (entry - stop) };
          resetLong();
          resetShort();
          continue;
        }
      }
    } else {
      resetLong();
    }

    // ---- SHORT setup ----
    if (bear) {
      if (!sSaw && c.close < f) sSaw = true;
      if (sSaw && c.high >= nearFLow) { sPulled = true; sSwingHigh = Math.max(sSwingHigh, c.high); }
      if (sPulled && c.close < c.open && c.close < f) { // red confirmation closing back below EMA34
        const entry = c.close, stop = sSwingHigh;
        if (stop > entry) {
          pos = { dir: 'short', entry, entryTime: c.openTime, stop, target: entry - rMult * (stop - entry) };
          resetLong();
          resetShort();
          continue;
        }
      }
    } else {
      resetShort();
    }
  }

  if (pos) {
    const last = candles[candles.length - 1]!.close;
    recordExit(pos, last, 'sl', candles[candles.length - 1]!.openTime); // mark-to-market label
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  const tpExits = trades.filter((t) => t.reason === 'tp').length;
  const avgR = trades.length ? trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length : 0;
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
    tpExits,
    avgR,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    exposure: exposure * 100,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, emaArg, rArg, nearArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '4h';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const periods = ((emaArg ?? '34,89,200').split(',').map(Number) as number[]).slice(0, 3) as [number, number, number];
  const rMult = Number(rArg ?? 2);
  const nearPct = Number(nearArg ?? 0) / 100;

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  console.log(`\n=== EMA PULLBACK + CONFIRM ${periods.join('/')} | TP ${rMult}R, SL swing | near ${(nearPct * 100).toFixed(2)}% | ${interval} | ${days}d | fee ${feePerSide}%/side ===`);
  console.log('symbol     | trades | tp | winRate | avgR  |   final$   | return% | maxDD% | expo%');
  const rows: { symbol: string; r: ReturnType<typeof runConfirm> }[] = [];
  for (const symbol of symbols) {
    const candles = await fetchKlines(symbol, interval, startMs, endMs);
    if (candles.length === 0) { console.log(`${symbol.padEnd(10)} | no data`); continue; }
    const r = runConfirm(candles, periods, rMult, nearPct, capital, feePerSide);
    rows.push({ symbol, r });
    console.log(
      `${symbol.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.tpExits).padStart(2)} | ${fmt(r.winRate * 100).padStart(6)}% | ${(r.avgR >= 0 ? '+' : '') + fmt(r.avgR)} | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${fmt(r.exposure).padStart(5)}`
    );
  }
  if (rows.length) {
    const avg = rows.reduce((a, x) => a + x.r.returnPct, 0) / rows.length;
    const avgWr = rows.reduce((a, x) => a + x.r.winRate, 0) / rows.length;
    console.log(`           | basket avg return ${(avg >= 0 ? '+' : '') + fmt(avg)}% | avg winRate ${fmt(avgWr * 100)}% (breakeven for ${rMult}R = ${fmt(100 / (rMult + 1))}%)`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
