/**
 * Small-cap PUMP entry study — "low-risk entry" finder.
 *
 * Goal (user request): coins like ATM / PIVX / ORDI pump hard then dump fast.
 * We want a BUY signal with the best upside AND the shallowest downside (low risk),
 * not a signal that catches the pump but leaves you deeply underwater first.
 *
 * For every closed daily candle we measure, over a forward window:
 *   - UP  = max forward gain   = max((high[j] - c) / c)        → the pump we could capture
 *   - MAE = max adverse excursion = min((low[j] - c) / c)      → how far underwater first (RISK)
 *
 * A good "low-risk entry" = high median UP, shallow median MAE, low %{MAE <= -20%}.
 *
 * Part A — PUMP CHARACTERISATION: how often each coin pumps and how fast it gives it back.
 * Part B — SIGNAL COMPARISON: baseline vs candidate pre-pump conditions, with risk metrics.
 *
 * No auth — public Binance daily klines. Logs nothing to DB.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-smallcap-pump-entry-backtest.ts
 */

// Named targets first, then a broader small-cap basket for statistical power.
const TARGETS = ['ATM', 'PIVX', 'ORDI'];
const EXTRA = [
  'DGB', 'SC', 'ZEN', 'NKN', 'BAND', 'RLC', 'CTSI', 'OGN', 'STORJ', 'COTI',
  'CELR', 'MTL', 'CHR', 'ARPA', 'DENT', 'HOT', 'WIN', 'LSK', 'BEAM', 'PHB',
  'ANKR', 'BAL', 'DUSK', 'WAN', 'FIO', 'AKRO', 'NULS', 'STPT', 'TROY', 'VITE',
];
const UNIVERSE = [...TARGETS, ...EXTRA];

const WINDOWS = [14, 30];           // forward windows in days
const WARMUP = 210;                  // need EMA200 + a little

type Config = { label: string; test: (s: Series, i: number) => boolean };
type Series = {
  sym: string;
  o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
  ema50: number[]; ema200: number[]; rsi: number[];
};

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

async function fetchDaily(symbol: string): Promise<Series | null> {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=1000`);
    if (!r.ok) return null;
    const k = (await r.json()) as any[];
    if (!Array.isArray(k) || k.length < 260) return null;
    const o = k.map((x) => parseFloat(x[1]));
    const h = k.map((x) => parseFloat(x[2]));
    const l = k.map((x) => parseFloat(x[3]));
    const c = k.map((x) => parseFloat(x[4]));
    const v = k.map((x) => parseFloat(x[5]));
    return { sym: symbol, o, h, l, c, v, ema50: ema(c, 50), ema200: ema(c, 200), rsi: rsiSeries(c, 14) };
  } catch { return null; }
}

// forward MAX gain (uses highs) over the next `days`
function fwdUp(s: Series, i: number, days: number): number {
  const base = s.c[i]!;
  let best = 0;
  for (let j = i + 1; j <= Math.min(i + days, s.c.length - 1); j++) {
    const r = (s.h[j]! - base) / base;
    if (r > best) best = r;
  }
  return best;
}
// forward MAX adverse excursion (uses lows) over the next `days` — most negative
function fwdMae(s: Series, i: number, days: number): number {
  const base = s.c[i]!;
  let worst = 0;
  for (let j = i + 1; j <= Math.min(i + days, s.c.length - 1); j++) {
    const r = (s.l[j]! - base) / base;
    if (r < worst) worst = r;
  }
  return worst;
}

function dropOver(s: Series, i: number, days: number): number {
  const ref = s.c[i - days];
  if (ref === undefined) return 0;
  return (s.c[i]! - ref) / ref;
}
function ddFromPeak(s: Series, i: number, lookback: number): number {
  let peak = -Infinity;
  for (let j = Math.max(0, i - lookback); j <= i; j++) if (s.h[j]! > peak) peak = s.h[j]!;
  return peak > 0 ? (peak - s.c[i]!) / peak : 0;
}
function volRatio(s: Series, i: number, lookback: number): number {
  let sum = 0; let n = 0;
  for (let j = Math.max(0, i - lookback); j < i; j++) { sum += s.v[j]!; n++; }
  const avg = n ? sum / n : 0;
  return avg > 0 ? s.v[i]! / avg : 0;
}

const median = (a: number[]) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : 0;
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pctGE = (a: number[], t: number) => a.length ? a.filter((v) => v >= t).length / a.length : 0;
const pctLE = (a: number[], t: number) => a.length ? a.filter((v) => v <= t).length / a.length : 0;

const CONFIGS: Config[] = [
  { label: 'BASELINE (every day)', test: () => true },
  {
    label: 'Oversold deep: RSI<30 & <EMA200 & drop>=25%/10d',
    test: (s, i) => s.rsi[i]! < 30 && s.c[i]! < s.ema200[i]! && dropOver(s, i, 10) <= -0.25,
  },
  {
    label: 'Oversold relaxed: RSI<35 & <EMA200 & drop>=15%/10d (catches low-vol like ATM)',
    test: (s, i) => s.rsi[i]! < 35 && s.c[i]! < s.ema200[i]! && dropOver(s, i, 10) <= -0.15,
  },
  {
    label: 'Oversold extreme: RSI<25 & drop>=35%/14d',
    test: (s, i) => s.rsi[i]! < 25 && dropOver(s, i, 14) <= -0.35,
  },
  {
    label: 'Beaten-down: DD>=70% from 365d peak & RSI<40',
    test: (s, i) => ddFromPeak(s, i, 365) >= 0.70 && s.rsi[i]! < 40,
  },
  {
    label: 'Capitulation+volume: RSI<30 & drop>=20%/7d & vol>=2x',
    test: (s, i) => s.rsi[i]! < 30 && dropOver(s, i, 7) <= -0.20 && volRatio(s, i, 30) >= 2,
  },
  {
    label: 'Pullback-to-EMA50 in uptrend: c>EMA200 & low<=EMA50 & RSI 35-55',
    test: (s, i) => s.c[i]! > s.ema200[i]! && s.l[i]! <= s.ema50[i]! && s.rsi[i]! >= 35 && s.rsi[i]! <= 55,
  },
];

function reportSignal(label: string, ups: Record<number, number[]>, maes: Record<number, number[]>, count: number) {
  console.log(`── ${label}  [n=${count} signal-days]`);
  for (const w of WINDOWS) {
    const u = ups[w]!; const m = maes[w]!;
    const ratio = median(m) !== 0 ? Math.abs(median(u) / median(m)) : Infinity;
    console.log(
      `   ${w}d  UP: med ${(median(u) * 100).toFixed(0)}% mean ${(mean(u) * 100).toFixed(0)}% | ` +
      `%≥+30% ${(pctGE(u, 0.3) * 100).toFixed(0)}% %≥+50% ${(pctGE(u, 0.5) * 100).toFixed(0)}%  ||  ` +
      `MAE: med ${(median(m) * 100).toFixed(0)}% | %≤-20% ${(pctLE(m, -0.20) * 100).toFixed(0)}% %≤-35% ${(pctLE(m, -0.35) * 100).toFixed(0)}%  ||  ` +
      `up/risk ${ratio === Infinity ? '∞' : ratio.toFixed(2)}`,
    );
  }
}

async function main() {
  const coins: Series[] = [];
  for (const sym of UNIVERSE) {
    const s = await fetchDaily(sym);
    if (s) coins.push(s);
    process.stdout.write(`${sym}${s ? '' : '(skip)'} `);
  }
  console.log(`\n\nUniverse with ≥260d D1: ${coins.length}/${UNIVERSE.length}\n`);

  // ───────── PART A — pump characterisation (per target + basket) ─────────
  console.log('=== PART A — PUMP CHARACTERISATION (D1) ===');
  console.log('coin     days  pumps≥50%/14d  median pump  median give-back 14d after peak  med daily |move|');
  const charCoins = [...coins];
  for (const s of charCoins) {
    const n = s.c.length;
    let events = 0; const pumpMags: number[] = []; const giveBacks: number[] = [];
    for (let i = WARMUP; i < n - 1; i++) {
      const up = fwdUp(s, i, 14);
      const prevUp = i > WARMUP ? fwdUp(s, i - 1, 14) : 0;
      if (up >= 0.50 && prevUp < 0.50) {
        events++; pumpMags.push(up);
        // find the peak high in next 14d, then measure drawdown 14d after that peak
        let peakIdx = i; let peak = -Infinity;
        for (let j = i + 1; j <= Math.min(i + 14, n - 1); j++) if (s.h[j]! > peak) { peak = s.h[j]!; peakIdx = j; }
        let trough = Infinity;
        for (let j = peakIdx + 1; j <= Math.min(peakIdx + 14, n - 1); j++) if (s.l[j]! < trough) trough = s.l[j]!;
        if (trough !== Infinity && peak > 0) giveBacks.push((trough - peak) / peak);
      }
    }
    const dailyMoves: number[] = [];
    for (let i = 1; i < n; i++) dailyMoves.push(Math.abs((s.c[i]! - s.c[i - 1]!) / s.c[i - 1]!));
    const onlyTarget = TARGETS.includes(s.sym) ? '*' : ' ';
    console.log(
      `${onlyTarget}${s.sym.padEnd(7)} ${String(n).padStart(4)}  ${String(events).padStart(11)}  ` +
      `${(median(pumpMags) * 100 || 0).toFixed(0).padStart(10)}%  ` +
      `${(median(giveBacks) * 100 || 0).toFixed(0).padStart(28)}%  ` +
      `${(median(dailyMoves) * 100).toFixed(1).padStart(13)}%`,
    );
  }
  console.log('  (* = your named targets ATM/PIVX/ORDI)\n');

  // ───────── PART B — signal comparison over whole universe ─────────
  console.log('=== PART B — SIGNAL COMPARISON (whole small-cap universe) ===');
  console.log('UP = max forward gain (upside).  MAE = max adverse excursion (downside risk).  up/risk = |medUP / medMAE|\n');
  for (const cfg of CONFIGS) {
    const ups: Record<number, number[]> = { 14: [], 30: [] };
    const maes: Record<number, number[]> = { 14: [], 30: [] };
    let count = 0;
    for (const s of coins) {
      for (let i = WARMUP; i < s.c.length - 1; i++) {
        if (Number.isNaN(s.ema200[i]!) || Number.isNaN(s.rsi[i]!)) continue;
        if (!cfg.test(s, i)) continue;
        count++;
        for (const w of WINDOWS) { ups[w]!.push(fwdUp(s, i, w)); maes[w]!.push(fwdMae(s, i, w)); }
      }
    }
    reportSignal(cfg.label, ups, maes, count);
  }
  console.log('');

  // ───────── PART C — best signal, broken down on the 3 targets only ─────────
  console.log('=== PART C — recommended signal on ATM / PIVX / ORDI only ===');
  const best = CONFIGS[2]!; // oversold RELAXED — universal coverage incl. low-vol ATM
  console.log(`signal: ${best.label}\n`);
  // TP ladder: among signal-days, how often does price reach +X within 14d (exit guidance)
  const TP = [0.15, 0.25, 0.40];
  for (const s of coins.filter((x) => TARGETS.includes(x.sym))) {
    const u14: number[] = []; const m14: number[] = [];
    for (let i = WARMUP; i < s.c.length - 1; i++) {
      if (Number.isNaN(s.ema200[i]!)) continue;
      if (!best.test(s, i)) continue;
      u14.push(fwdUp(s, i, 14)); m14.push(fwdMae(s, i, 14));
    }
    const tpHits = TP.map((t) => (pctGE(u14, t) * 100).toFixed(0) + '%').join(' / ');
    console.log(
      `${s.sym.padEnd(6)} signals=${String(u14.length).padStart(3)} | 14d UP med ${(median(u14) * 100 || 0).toFixed(0)}% ` +
      `| reach +15/+25/+40%: ${tpHits} | MAE med ${(median(m14) * 100 || 0).toFixed(0)}% %≤-20% ${(pctLE(m14, -0.2) * 100).toFixed(0)}%`,
    );
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
