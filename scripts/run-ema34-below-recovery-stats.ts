/**
 * EMA34 "how deep below before price comes back" STATISTICS (not a P&L backtest).
 *
 * Question (user): on H4 and D1, on average how many % below EMA34 does price go
 * before it recovers back to the EMA34 line?
 *
 * Method — episode based:
 *   - An EPISODE starts on the first candle that CLOSES below EMA34 (close < ema).
 *   - It ends on the first later candle whose HIGH touches EMA34 (high >= ema of that bar).
 *     EMA34 is recomputed every bar, so "touching back" is measured against the moving line.
 *   - Per episode we record:
 *       maxDevPct  = max over the episode of (ema - low) / ema * 100   (deepest excursion)
 *       closeDevPct= max over the episode of (ema - close) / ema * 100 (deepest CLOSE below)
 *       bars       = bars from the first below-close until the touch-back
 *   - Episodes still open at the end of data are reported separately (unresolved).
 *
 * Also prints a CONDITIONAL table: given an episode reaches depth >= D%, what share
 * recover to EMA34, how deep they finally go, and how many bars it takes. This answers
 * "if I'm N% under EMA34, is a bounce back to EMA34 still likely / how long?".
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema34-below-recovery-stats.ts \
 *     [symbols] [intervals] [days] [emaPeriod]
 *   e.g. ... ETHUSDT "4h,1d" 2200 34
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

function fmt(n: number, d = 2): string {
  if (!isFinite(n)) return '-';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

type Episode = {
  startTime: Date;
  endTime: Date | null;
  maxDevPct: number;   // deepest low below EMA
  closeDevPct: number; // deepest close below EMA
  bars: number;        // bars until touch-back (or until end of data if unresolved)
  resolved: boolean;
};

function collectEpisodesWithBars(candles: Candle[], emaPeriod: number): Episode[] {
  const closes = candles.map((c) => c.close);
  const e = ema(closes, emaPeriod);
  const episodes: Episode[] = [];
  let startIdx = -1;
  let maxDev = 0;
  let maxCloseDev = 0;

  for (let i = emaPeriod; i < candles.length; i++) {
    const c = candles[i]!;
    const em = e[i]!;
    if (!isFinite(em) || em <= 0) continue;

    if (startIdx < 0) {
      if (c.close < em) {
        startIdx = i;
        maxDev = ((em - c.low) / em) * 100;
        maxCloseDev = ((em - c.close) / em) * 100;
      }
      continue;
    }

    const devLow = ((em - c.low) / em) * 100;
    const devClose = ((em - c.close) / em) * 100;
    if (devLow > maxDev) maxDev = devLow;
    if (devClose > maxCloseDev) maxCloseDev = devClose;

    if (c.high >= em) {
      episodes.push({
        startTime: candles[startIdx]!.openTime,
        endTime: c.openTime,
        maxDevPct: maxDev,
        closeDevPct: maxCloseDev,
        bars: i - startIdx,
        resolved: true,
      });
      startIdx = -1;
    }
  }

  if (startIdx >= 0) {
    episodes.push({
      startTime: candles[startIdx]!.openTime,
      endTime: null,
      maxDevPct: maxDev,
      closeDevPct: maxCloseDev,
      bars: candles.length - 1 - startIdx,
      resolved: false,
    });
  }
  return episodes;
}

function describe(label: string, values: number[]): void {
  if (values.length === 0) {
    console.log(`${label.padEnd(28)} | no samples`);
    return;
  }
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  console.log(
    `${label.padEnd(28)} | n=${String(s.length).padStart(4)} | avg ${fmt(mean).padStart(6)} | med ${fmt(quantile(s, 0.5)).padStart(6)} | p75 ${fmt(quantile(s, 0.75)).padStart(6)} | p90 ${fmt(quantile(s, 0.9)).padStart(6)} | p95 ${fmt(quantile(s, 0.95)).padStart(6)} | max ${fmt(s[s.length - 1]!).padStart(7)}`,
  );
}

async function main() {
  const [, , symArg, intArg, daysArg, emaArg] = process.argv;
  const symbols = (symArg ?? 'ETHUSDT').split(',').map((s) => s.trim().toUpperCase());
  const intervals = (intArg ?? '4h,1d').split(',').map((s) => s.trim());
  const days = Number(daysArg ?? 2200);
  const emaPeriod = Number(emaArg ?? 34);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  for (const symbol of symbols) {
    for (const interval of intervals) {
      const candles = await fetchKlines(symbol, interval, startMs, endMs);
      const span = candles.length
        ? `${candles[0]!.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]!.openTime.toISOString().slice(0, 10)}`
        : 'no data';
      console.log(`\n================ ${symbol} ${interval} | EMA${emaPeriod} | ${candles.length} candles (${span}) ================`);
      if (candles.length < emaPeriod + 10) {
        console.log('not enough data');
        continue;
      }

      const eps = collectEpisodesWithBars(candles, emaPeriod);
      const resolved = eps.filter((e) => e.resolved);
      const unresolved = eps.filter((e) => !e.resolved);

      console.log(`episodes below EMA${emaPeriod}: ${eps.length}  (recovered to EMA: ${resolved.length}, still open at end: ${unresolved.length})`);

      console.log('\n-- depth of the excursion (% below EMA34), resolved episodes --');
      describe('max depth by LOW  (%)', resolved.map((e) => e.maxDevPct));
      describe('max depth by CLOSE (%)', resolved.map((e) => e.closeDevPct));
      describe('bars to touch EMA again', resolved.map((e) => e.bars));

      if (unresolved.length) {
        console.log('\n-- unresolved (open) episodes --');
        for (const u of unresolved) {
          console.log(`  since ${u.startTime.toISOString().slice(0, 10)} | depth low ${fmt(u.maxDevPct)}% | depth close ${fmt(u.closeDevPct)}% | ${u.bars} bars so far`);
        }
      }

      // Conditional: given the episode already reached depth >= D, what happens next?
      console.log('\n-- conditional on already being D% below EMA34 --');
      console.log('D%   | episodes | recovered% | avg final depth% | med final depth% | avg bars to EMA | med bars');
      const grid = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];
      for (const d of grid) {
        const sub = eps.filter((e) => e.maxDevPct >= d);
        if (sub.length === 0) continue;
        const rec = sub.filter((e) => e.resolved);
        const depths = [...rec.map((e) => e.maxDevPct)].sort((a, b) => a - b);
        const bars = [...rec.map((e) => e.bars)].sort((a, b) => a - b);
        const avgDepth = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : NaN;
        const avgBars = bars.length ? bars.reduce((a, b) => a + b, 0) / bars.length : NaN;
        console.log(
          `${String(d).padStart(3)}  | ${String(sub.length).padStart(8)} | ${fmt((rec.length / sub.length) * 100).padStart(9)}% | ${fmt(avgDepth).padStart(16)} | ${fmt(quantile(depths, 0.5)).padStart(16)} | ${fmt(avgBars, 1).padStart(15)} | ${fmt(quantile(bars, 0.5), 1).padStart(8)}`,
        );
      }

      // How much extra downside AFTER a close that is D% below EMA34 (entry-timing view).
      console.log('\n-- if you BUY on a close that is D% below EMA34 (per-signal, first close crossing D) --');
      console.log('D%   | signals | recovered% | avg extra drawdown% | med extra dd% | avg bars to EMA | med bars');
      const closes = candles.map((c) => c.close);
      const e34 = ema(closes, emaPeriod);
      for (const d of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20]) {
        let signals = 0, recovered = 0;
        const extraDDs: number[] = [];
        const barsList: number[] = [];
        let armed = true; // only take the FIRST close crossing D within an episode
        for (let i = emaPeriod; i < candles.length; i++) {
          const em = e34[i]!;
          if (!isFinite(em) || em <= 0) continue;
          const c = candles[i]!;
          if (c.close >= em) { armed = true; continue; }
          const devClose = ((em - c.close) / em) * 100;
          if (!armed || devClose < d) continue;
          armed = false;
          signals++;
          const entry = c.close;
          let minLow = entry;
          let done = false;
          for (let j = i + 1; j < candles.length; j++) {
            const cj = candles[j]!;
            const emj = e34[j]!;
            if (cj.low < minLow) minLow = cj.low;
            if (isFinite(emj) && cj.high >= emj) {
              recovered++;
              extraDDs.push(((entry - minLow) / entry) * 100);
              barsList.push(j - i);
              done = true;
              break;
            }
          }
          if (!done) extraDDs.push(((entry - minLow) / entry) * 100);
        }
        if (signals === 0) continue;
        const dds = [...extraDDs].sort((a, b) => a - b);
        const bs = [...barsList].sort((a, b) => a - b);
        console.log(
          `${String(d).padStart(3)}  | ${String(signals).padStart(7)} | ${fmt((recovered / signals) * 100).padStart(9)}% | ${fmt(dds.reduce((a, b) => a + b, 0) / dds.length).padStart(19)} | ${fmt(quantile(dds, 0.5)).padStart(13)} | ${fmt(bs.length ? bs.reduce((a, b) => a + b, 0) / bs.length : NaN, 1).padStart(15)} | ${fmt(quantile(bs, 0.5), 1).padStart(8)}`,
        );
      }
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
