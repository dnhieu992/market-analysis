/**
 * M30 TP solution that KEEPS the edge: always-in-market UTBot stop-and-reverse
 * (SL = the UTBot trailing line, no hard stop) + an ATR-scaled partial take-profit.
 *
 * The fixed +5% partial almost never fires on M30; a hard ATR stop kills the trend
 * capture that makes the method work (see run-flip-atr-bracket — low DD but negative).
 * So: stay always-in-market, but bank half at +tpMult×ATR (achievable on M30) and ratchet
 * SL to breakeven. The runner rides the UTBot flip, or exits at breakeven if price returns.
 *
 *   - Baseline column = pure flip (no TP), for reference.
 *   - NEW column = flip + partial(half) at entry ± tpMult×ATR(entry) + breakeven runner.
 *   - Fees = 2×feePerSide per trade. No leverage/slippage. Capital compounded.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-flip-partial-atr-backtest.ts \
 *     [symbol] [interval] [days] [capital] [feePctPerSide] [kvList] [tpMult]
 *   e.g. ... ETHUSDT 30m 365 1000 0.05 "8,10,12" 1.5
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;
const PARTIAL_FRACTION = 0.5;

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

type Result = { trades: number; winRate: number; returnPct: number; maxDD: number; partials: number };

function metrics(rets: number[], capital: number, partials: number): Result {
  const wins = rets.filter((r) => r > 0).length;
  let eq = capital, peak = capital, maxDD = 0;
  for (const r of rets) {
    eq *= 1 + r;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return { trades: rets.length, winRate: rets.length ? (wins / rets.length) * 100 : 0, returnPct: (eq / capital - 1) * 100, maxDD: maxDD * 100, partials };
}

function runFlip(candles: Candle[], kv: number, capital: number, feePerSide: number): Result {
  const stop = utBotStops(candles, ATR_PERIOD, kv);
  const fee = feePerSide / 100;
  const trendAt = (i: number) => (i < ATR_PERIOD || stop[i] === 0 ? null : candles[i]!.close > stop[i]! ? 'bull' : 'bear');
  const rets: number[] = [];
  let pos: { dir: 'long' | 'short'; entry: number } | null = null;
  let prevTrend: string | null = null;
  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const close = candles[i]!.close;
    if (pos === null && prevTrend === null) { pos = { dir: t === 'bull' ? 'long' : 'short', entry: close }; prevTrend = t; continue; }
    if (t !== prevTrend && pos) {
      const g = pos.dir === 'long' ? (close - pos.entry) / pos.entry : (pos.entry - close) / pos.entry;
      rets.push(g - 2 * fee);
      pos = { dir: t === 'bull' ? 'long' : 'short', entry: close };
      prevTrend = t;
    }
  }
  if (pos) {
    const last = candles[candles.length - 1]!.close;
    const g = pos.dir === 'long' ? (last - pos.entry) / pos.entry : (pos.entry - last) / pos.entry;
    rets.push(g - fee);
  }
  return metrics(rets, capital, 0);
}

function runFlipPartialAtr(candles: Candle[], atr: number[], kv: number, capital: number, feePerSide: number, tpMult: number, breakeven = true): Result {
  const stop = utBotStops(candles, ATR_PERIOD, kv);
  const fee = feePerSide / 100;
  const trendAt = (i: number) => (i < ATR_PERIOD || stop[i] === 0 ? null : candles[i]!.close > stop[i]! ? 'bull' : 'bear');
  const rets: number[] = [];
  let partials = 0;
  let pos: { dir: 'long' | 'short'; entry: number; atr: number; partialDone: boolean } | null = null;
  let prevTrend: string | null = null;

  const close = (p: NonNullable<typeof pos>, exitPrice: number) => {
    const remFrac = p.partialDone ? 1 - PARTIAL_FRACTION : 1;
    const grossRem = p.dir === 'long' ? (exitPrice - p.entry) / p.entry : (p.entry - exitPrice) / p.entry;
    const tpRet = (tpMult * p.atr) / p.entry; // +tpMult×ATR as a fraction of entry
    const grossPartial = p.partialDone ? PARTIAL_FRACTION * tpRet : 0;
    rets.push(grossPartial + remFrac * grossRem - 2 * fee);
  };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const c = candles[i]!;
    if (pos === null) { pos = { dir: t === 'bull' ? 'long' : 'short', entry: c.close, atr: atr[i]!, partialDone: false }; prevTrend = t; continue; }

    const long = pos.dir === 'long';
    const tpPrice = long ? pos.entry + tpMult * pos.atr : pos.entry - tpMult * pos.atr;

    // A. Breakeven stop on the runner (only after a partial on a PRIOR candle).
    if (breakeven && pos.partialDone) {
      const beHit = long ? c.low <= pos.entry : c.high >= pos.entry;
      if (beHit) { close(pos, pos.entry); pos = null; continue; }
    }
    // B. Partial intra-candle at +tpMult×ATR.
    if (!pos.partialDone) {
      const tpHit = long ? c.high >= tpPrice : c.low <= tpPrice;
      if (tpHit) { pos.partialDone = true; partials++; }
    }
    // C. Flip on close → exit remainder + reverse.
    if (t !== prevTrend) {
      close(pos, c.close);
      pos = { dir: t === 'bull' ? 'long' : 'short', entry: c.close, atr: atr[i]!, partialDone: false };
      prevTrend = t;
    }
  }
  if (pos) close(pos, candles[candles.length - 1]!.close);
  return metrics(rets, capital, partials);
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, kvArg, tpArg] = process.argv;
  const symbol = symArg ?? 'ETHUSDT';
  const interval = intArg ?? '30m';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const kvList = (kvArg ?? '8,10,12').split(',').map(Number);
  const tpMult = Number(tpArg ?? 1.5);
  const breakeven = (process.argv[9] ?? '1') !== '0'; // pass 0 to disable the breakeven runner stop

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${symbol} ${interval} (${days}d)...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  const atr = wilderAtr(candles, ATR_PERIOD);
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`);

  console.log(`\n=== ${symbol} ${interval} | ATR(${ATR_PERIOD}) | always-in-market + partial ${tpMult}×ATR on ${PARTIAL_FRACTION * 100}% | breakeven=${breakeven ? 'on' : 'OFF'} | $${capital} | fee ${feePerSide}%/side ===`);
  console.log('         BASELINE (flip, no TP)                  |  NEW (partial tpMult×ATR + breakeven runner)');
  console.log('kv | trades  winRate    final$    ret%   maxDD%  | trades  winRate    final$    ret%   maxDD%  prt');
  for (const kv of kvList) {
    const b = runFlip(candles, kv, capital, feePerSide);
    const n = runFlipPartialAtr(candles, atr, kv, capital, feePerSide, tpMult, breakeven);
    const row = (r: Result) => `${String(r.trades).padStart(6)} ${fmt(r.winRate).padStart(6)}% ${('$' + fmt(capital * (1 + r.returnPct / 100))).padStart(10)} ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct, 0)).padStart(6)}% ${fmt(r.maxDD, 0).padStart(5)}%`;
    console.log(`${String(kv).padStart(2)} | ${row(b)}  | ${row(n)}  ${String(n.partials).padStart(3)}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
