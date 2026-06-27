/**
 * Backtest: does an "Oversold / Primed" pre-pump signal catch small-cap pumps?
 *
 * Hypothesis (from the PIVX case): deeply oversold capitulation
 * (RSI < t, price below EMA200, big multi-day drop) precedes sharp bounces.
 *
 * For each coin (daily candles) we:
 *   - compute the signal on each closed day
 *   - measure FORWARD returns (max gain over next 14d / 30d) after a signal
 *   - compare against the unconditional baseline (every day)
 *   - measure RECALL: of all big pump events, how many had a signal in the prior window
 *
 * No auth — public Binance klines. Logs nothing to DB.
 */

const UNIVERSE = [
  'PIVX', 'DGB', 'SC', 'ZEN', 'NKN', 'BAND', 'RLC', 'CTSI', 'OGN', 'STORJ',
  'BAL', 'ANKR', 'COTI', 'CELR', 'DUSK', 'PERL', 'MTL', 'FUN', 'KEY', 'DENT',
  'STMX', 'HOT', 'WIN', 'DOCK', 'ARPA', 'CHR', 'TROY', 'VITE', 'DREP', 'WAN',
  'FIO', 'AKRO', 'IRIS', 'WNXM', 'BTS', 'LSK', 'NULS', 'BEAM', 'PHB', 'STPT',
];

const LOOKAHEAD = [14, 30];      // forward windows (days)
const PRE_WINDOW = 10;           // signal must fire within this many days BEFORE a pump to count as caught
const PUMP_FWD_DAYS = 14;        // a "pump event" = max forward return over this window ...
const PUMP_THRESH = 0.50;        // ... of >= +50%

type Config = { rsiMax: number; dropDays: number; dropPct: number; label: string };
const CONFIGS: Config[] = [
  { rsiMax: 30, dropDays: 7, dropPct: -0.20, label: 'RSI<30 + EMA200- + drop>=20%/7d' },
  { rsiMax: 30, dropDays: 7, dropPct: -0.30, label: 'RSI<30 + EMA200- + drop>=30%/7d' },
  { rsiMax: 25, dropDays: 7, dropPct: -0.25, label: 'RSI<25 + EMA200- + drop>=25%/7d' },
  { rsiMax: 35, dropDays: 10, dropPct: -0.25, label: 'RSI<35 + EMA200- + drop>=25%/10d' },
  { rsiMax: 30, dropDays: 14, dropPct: -0.30, label: 'RSI<30 + EMA200- + drop>=30%/14d' },
  { rsiMax: 30, dropDays: 10, dropPct: -0.25, label: 'RSI<30 + EMA200- + drop>=25%/10d (CHOSEN)' },
];

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < values.length; i++) {
    if (i < period) { out.push(NaN); continue; }
    if (i === period) { out.push(e); continue; }
    e = values[i]! * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function rsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i]! - closes[i - 1]!; if (d >= 0) g += d; else l -= d; }
  g /= period; l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) { g = (g * (period - 1) + d) / period; l = (l * (period - 1)) / period; }
    else { g = (g * (period - 1)) / period; l = (l * (period - 1) - d) / period; }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

async function fetchDaily(symbol: string): Promise<number[][] | null> {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=1000`);
    if (!r.ok) return null;
    const k = (await r.json()) as any[];
    if (!Array.isArray(k) || k.length < 220) return null;
    return k.map((x) => [parseFloat(x[1]), parseFloat(x[2]), parseFloat(x[3]), parseFloat(x[4])]); // o,h,l,c
  } catch { return null; }
}

function maxFwdReturn(closes: number[], highs: number[], i: number, days: number): number {
  const base = closes[i]!;
  let best = -Infinity;
  for (let j = i + 1; j <= Math.min(i + days, closes.length - 1); j++) {
    const r = (highs[j]! - base) / base;
    if (r > best) best = r;
  }
  return best === -Infinity ? 0 : best;
}

function pct(arr: number[], threshold: number): number {
  if (arr.length === 0) return 0;
  return arr.filter((v) => v >= threshold).length / arr.length;
}
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function main() {
  const coins: { sym: string; o: number[]; h: number[]; l: number[]; c: number[] }[] = [];
  for (const sym of UNIVERSE) {
    const k = await fetchDaily(sym);
    if (!k) { continue; }
    coins.push({ sym, o: k.map((x) => x[0]!), h: k.map((x) => x[1]!), l: k.map((x) => x[2]!), c: k.map((x) => x[3]!) });
  }
  console.log(`Universe: ${coins.length}/${UNIVERSE.length} coins with >=220d data (~${1000} candles each).\n`);

  // ---- Baseline: forward returns over ALL days (every coin, every day) ----
  for (const win of LOOKAHEAD) {
    const all: number[] = [];
    for (const c of coins) for (let i = 210; i < c.c.length - 1; i++) all.push(maxFwdReturn(c.c, c.h, i, win));
    console.log(`BASELINE forward max-return over ${win}d (any day): median ${(median(all) * 100).toFixed(1)}% | mean ${(mean(all) * 100).toFixed(1)}% | %>=+20%: ${(pct(all, 0.2) * 100).toFixed(0)}% | %>=+50%: ${(pct(all, 0.5) * 100).toFixed(0)}%`);
  }
  console.log('');

  // ---- Per config ----
  for (const cfg of CONFIGS) {
    let signals = 0;
    const fwd14: number[] = [], fwd30: number[] = [];
    // recall accounting
    let pumpEvents = 0, pumpsCaught = 0;

    for (const c of coins) {
      const ema200 = ema(c.c, 200);
      const rsi = rsiSeries(c.c, 14);
      const signalDays: boolean[] = new Array(c.c.length).fill(false);

      for (let i = 210; i < c.c.length - 1; i++) {
        const dropRef = c.c[i - cfg.dropDays];
        if (dropRef === undefined) continue;
        const drop = (c.c[i]! - dropRef) / dropRef;
        const fired = rsi[i]! < cfg.rsiMax && c.c[i]! < ema200[i]! && drop <= cfg.dropPct;
        signalDays[i] = fired;
        if (fired) {
          signals++;
          fwd14.push(maxFwdReturn(c.c, c.h, i, 14));
          fwd30.push(maxFwdReturn(c.c, c.h, i, 30));
        }
      }

      // recall: find pump events, check if a signal fired in the PRE_WINDOW before
      for (let i = 210; i < c.c.length - 1; i++) {
        const fwd = maxFwdReturn(c.c, c.h, i, PUMP_FWD_DAYS);
        // mark the START of a pump: today's jump triggers it; approximate event as a day whose
        // forward window reaches threshold but the prior day did not (de-dup consecutive)
        if (fwd >= PUMP_THRESH) {
          const prevFwd = i > 210 ? maxFwdReturn(c.c, c.h, i - 1, PUMP_FWD_DAYS) : 0;
          if (prevFwd >= PUMP_THRESH) continue; // same event, skip
          pumpEvents++;
          let caught = false;
          for (let j = Math.max(210, i - PRE_WINDOW); j <= i; j++) if (signalDays[j]) { caught = true; break; }
          if (caught) pumpsCaught++;
        }
      }
    }

    console.log(`── ${cfg.label}`);
    console.log(`   signal-days: ${signals}`);
    console.log(`   FWD 14d: median ${(median(fwd14) * 100).toFixed(1)}% | mean ${(mean(fwd14) * 100).toFixed(1)}% | %>=+20%: ${(pct(fwd14, 0.2) * 100).toFixed(0)}% | %>=+50%: ${(pct(fwd14, 0.5) * 100).toFixed(0)}%`);
    console.log(`   FWD 30d: median ${(median(fwd30) * 100).toFixed(1)}% | mean ${(mean(fwd30) * 100).toFixed(1)}% | %>=+20%: ${(pct(fwd30, 0.2) * 100).toFixed(0)}% | %>=+50%: ${(pct(fwd30, 0.5) * 100).toFixed(0)}%`);
    console.log(`   RECALL (pumps >=+${(PUMP_THRESH * 100).toFixed(0)}%/${PUMP_FWD_DAYS}d caught within ${PRE_WINDOW}d prior): ${pumpsCaught}/${pumpEvents} = ${pumpEvents ? (pumpsCaught / pumpEvents * 100).toFixed(0) : '0'}%`);
    console.log('');
  }
}

main();
