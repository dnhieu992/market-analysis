/**
 * EMA 34/89/200 PULLBACK strategy v2 — adds two filters over v1:
 *   (1) FRESH pullback: only enter on the FIRST tap of EMA34. The previous candle
 *       must have been extended off EMA34 (its low strictly above EMA34 for longs,
 *       its high strictly below for shorts). Stops re-entering every bar while price
 *       rides the line — the main cause of H4 over-trading in v1.
 *   (2) REGIME filter: only trade when the EMA34<->EMA200 spread is wide enough,
 *       |EMA34 - EMA200| / EMA200 >= minSpreadPct. Skips chop around EMA200.
 *
 * Otherwise identical to v1:
 *   LONG: stack close>EMA34>EMA89>EMA200, enter on fresh EMA34 tap that closes back
 *         above EMA34. ATR trailing-stop take-profit; forced exit on close < EMA34.
 *   SHORT: mirror image.
 *   One position at a time, $1000 compounded, fee 0.05%/side both sides.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema-pullback-v2-backtest.ts \
 *     [symbols] [interval] [days] [capital] [feePctPerSide] [emaPeriods] [atrMultList] [atrPeriod] [minSpreadPct]
 *   e.g. ... "BTCUSDT,ETHUSDT" 1d 730 1000 0.05 "34,89,200" "2" 14 2
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

function wilderAtr(c: Candle[], period: number): number[] {
  const n = c.length;
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close))));
  const atr = new Array(n).fill(NaN);
  if (n < period) return atr;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  return atr;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Trade = { dir: 'long' | 'short'; entry: number; exit: number; entryTime: Date; exitTime: Date; retPct: number; reason: 'trail' | 'ema34' };

function runPullbackV2(
  candles: Candle[],
  periods: [number, number, number],
  atrPeriod: number,
  atrMult: number,
  minSpread: number, // fraction, e.g. 0.02
  capital: number,
  feePerSide: number,
) {
  const closes = candles.map((c) => c.close);
  const [pf, pm, ps] = periods;
  const eF = ema(closes, pf);
  const eM = ema(closes, pm);
  const eS = ema(closes, ps);
  const atr = wilderAtr(candles, atrPeriod);
  const fee = feePerSide / 100;
  const warmup = Math.max(pf, pm, ps, atrPeriod) + 1; // +1 so prev candle is valid

  const trades: Trade[] = [];
  let equity = capital;
  let barsInMarket = 0;
  let pos: { dir: 'long' | 'short'; entry: number; entryTime: Date; stop: number } | null = null;

  const ret = (dir: 'long' | 'short', entry: number, exit: number) =>
    (dir === 'long' ? (exit - entry) / entry : (entry - exit) / entry) - 2 * fee;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const f = eF[i]!, m = eM[i]!, s = eS[i]!, a = atr[i]!;
    const fPrev = eF[i - 1]!;
    if (!isFinite(f) || !isFinite(m) || !isFinite(s) || !isFinite(a) || !isFinite(fPrev)) continue;

    if (pos === null) {
      const spread = Math.abs(f - s) / s;
      const wideEnough = spread >= minSpread;
      // LONG: bullish stack, wide regime, FRESH tap (prev bar's low above its EMA34)
      const longSetup = wideEnough && c.close > f && f > m && m > s && c.low <= f && prev.low > fPrev;
      // SHORT: bearish stack, wide regime, FRESH tap (prev bar's high below its EMA34)
      const shortSetup = wideEnough && c.close < f && f < m && m < s && c.high >= f && prev.high < fPrev;
      if (longSetup) pos = { dir: 'long', entry: c.close, entryTime: c.openTime, stop: c.close - atrMult * a };
      else if (shortSetup) pos = { dir: 'short', entry: c.close, entryTime: c.openTime, stop: c.close + atrMult * a };
      continue;
    }

    barsInMarket++;

    if (pos.dir === 'long') {
      if (c.low <= pos.stop) {
        const r = ret('long', pos.entry, pos.stop);
        equity *= 1 + r;
        trades.push({ dir: 'long', entry: pos.entry, exit: pos.stop, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, reason: 'trail' });
        pos = null;
        continue;
      }
      if (c.close < f) {
        const r = ret('long', pos.entry, c.close);
        equity *= 1 + r;
        trades.push({ dir: 'long', entry: pos.entry, exit: c.close, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, reason: 'ema34' });
        pos = null;
        continue;
      }
      pos.stop = Math.max(pos.stop, c.close - atrMult * a);
    } else {
      if (c.high >= pos.stop) {
        const r = ret('short', pos.entry, pos.stop);
        equity *= 1 + r;
        trades.push({ dir: 'short', entry: pos.entry, exit: pos.stop, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, reason: 'trail' });
        pos = null;
        continue;
      }
      if (c.close > f) {
        const r = ret('short', pos.entry, c.close);
        equity *= 1 + r;
        trades.push({ dir: 'short', entry: pos.entry, exit: c.close, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, reason: 'ema34' });
        pos = null;
        continue;
      }
      pos.stop = Math.min(pos.stop, c.close + atrMult * a);
    }
  }

  if (pos) {
    const last = candles[candles.length - 1]!.close;
    const r = ret(pos.dir, pos.entry, last);
    equity *= 1 + r;
    trades.push({ dir: pos.dir, entry: pos.entry, exit: last, entryTime: pos.entryTime, exitTime: candles[candles.length - 1]!.openTime, retPct: r, reason: 'ema34' });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  const trailExits = trades.filter((t) => t.reason === 'trail').length;
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
    trailExits,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    exposure: exposure * 100,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, emaArg, multArg, atrPArg, spreadArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '1d';
  const days = Number(daysArg ?? 730);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const periods = ((emaArg ?? '34,89,200').split(',').map(Number) as number[]).slice(0, 3) as [number, number, number];
  const mults = (multArg ?? '2').split(',').map(Number);
  const atrPeriod = Number(atrPArg ?? 14);
  const minSpread = Number(spreadArg ?? 2) / 100; // percent -> fraction

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  const dataBySymbol = new Map<string, Candle[]>();
  for (const symbol of symbols) dataBySymbol.set(symbol, await fetchKlines(symbol, interval, startMs, endMs));

  for (const mult of mults) {
    console.log(`\n=== EMA PULLBACK v2 ${periods.join('/')} | freshTap + spread>=${(minSpread * 100).toFixed(1)}% | ATR(${atrPeriod})x${mult} trail | ${interval} | ${days}d | fee ${feePerSide}%/side ===`);
    console.log('symbol     | trades | trail | winRate |   final$   | return% | maxDD% | expo%');
    const rows: { symbol: string; r: ReturnType<typeof runPullbackV2> }[] = [];
    for (const symbol of symbols) {
      const candles = dataBySymbol.get(symbol)!;
      if (!candles || candles.length === 0) {
        console.log(`${symbol.padEnd(10)} | no data`);
        continue;
      }
      const r = runPullbackV2(candles, periods, atrPeriod, mult, minSpread, capital, feePerSide);
      rows.push({ symbol, r });
      console.log(
        `${symbol.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.trailExits).padStart(5)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${fmt(r.exposure).padStart(5)}`
      );
    }
    const agg = rows.reduce((acc, x) => acc + x.r.returnPct, 0);
    if (rows.length) console.log(`           | basket avg return: ${(agg / rows.length >= 0 ? '+' : '') + fmt(agg / rows.length)}%`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
