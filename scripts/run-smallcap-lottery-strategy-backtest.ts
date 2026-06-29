/**
 * Small-cap "lottery" spot strategy backtest.
 *
 * Context: user buys these mid/small-caps as LOTTERY TICKETS — small fixed size vs the
 * main book. So we DON'T compound and we DON'T use a tight stop; we accept the dump risk
 * on each ticket and rely on asymmetric upside + a TP ladder + a time stop.
 *
 * Rules per ticket (long-only spot):
 *   Entry  : oversold capitulation fires (RSI<rsiMax & close<EMA200 & drop>=dropPct/dropDays).
 *            Buy at that day's close. One open ticket per coin at a time (no pyramiding).
 *   Sizing : FLAT $stake per ticket (no compounding — lottery).
 *   Exit   : scale-out ladder — sell `p1` of the ticket if high touches +tp1,
 *            then sell the rest if high touches +tp2; whatever is left is sold at the
 *            close after `maxHold` days (time stop). Optional disaster stop at -dis.
 *   Fees   : feePerSide each entry and each exit leg.
 *
 * Reports per config: tickets, win-rate, mean/median ticket return (net), total basket PnL
 * on a fixed bankroll = stake × (#coins), best/worst ticket, %tickets that hit tp1 / tp2.
 *
 * No auth — public Binance D1 klines.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-smallcap-lottery-strategy-backtest.ts
 */

const TARGETS = ['ATM', 'PIVX', 'ORDI'];
const EXTRA = [
  'DGB', 'SC', 'ZEN', 'NKN', 'BAND', 'RLC', 'CTSI', 'OGN', 'STORJ', 'COTI',
  'CELR', 'MTL', 'CHR', 'ARPA', 'DENT', 'HOT', 'WIN', 'LSK', 'BEAM', 'PHB',
  'ANKR', 'BAL', 'DUSK', 'WAN', 'FIO', 'AKRO', 'NULS', 'STPT', 'TROY', 'VITE',
];
const UNIVERSE = [...TARGETS, ...EXTRA];
const WARMUP = 210;
const STAKE = 100; // $ per ticket, flat

type Series = { sym: string; o: number[]; h: number[]; l: number[]; c: number[]; ema200: number[]; rsi: number[] };

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1); const out: number[] = [];
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < values.length; i++) {
    if (i < period) { out.push(NaN); continue; }
    if (i === period) { out.push(e); continue; }
    e = values[i]! * k + e * (1 - k); out.push(e);
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
    const c = k.map((x) => parseFloat(x[4]));
    return {
      sym: symbol, o: k.map((x) => parseFloat(x[1])), h: k.map((x) => parseFloat(x[2])),
      l: k.map((x) => parseFloat(x[3])), c, ema200: ema(c, 200), rsi: rsiSeries(c, 14),
    };
  } catch { return null; }
}

type Cfg = {
  label: string;
  rsiMax: number; dropDays: number; dropPct: number;
  tp1: number; p1: number; tp2: number; maxHold: number; dis: number | null;
  feePerSide: number;
};

type Ticket = { sym: string; ret: number; hitTp1: boolean; hitTp2: boolean; reason: string };

function dropOver(s: Series, i: number, days: number): number {
  const ref = s.c[i - days]; if (ref === undefined) return 0; return (s.c[i]! - ref) / ref;
}

function runCoin(s: Series, cfg: Cfg): Ticket[] {
  const fee = cfg.feePerSide / 100;
  const tickets: Ticket[] = [];
  let i = WARMUP;
  while (i < s.c.length - 1) {
    if (Number.isNaN(s.ema200[i]!) || Number.isNaN(s.rsi[i]!)) { i++; continue; }
    const fired = s.rsi[i]! < cfg.rsiMax && s.c[i]! < s.ema200[i]! && dropOver(s, i, cfg.dropDays) <= cfg.dropPct;
    if (!fired) { i++; continue; }

    const entry = s.c[i]!;
    let remaining = 1; // fraction of ticket still held
    let realized = 0;  // net return contribution (fraction units, of full ticket)
    realized -= fee;   // entry fee on full ticket
    let hitTp1 = false, hitTp2 = false; let reason = 'time';
    let exitIdx = Math.min(i + cfg.maxHold, s.c.length - 1);

    for (let j = i + 1; j <= exitIdx; j++) {
      // disaster stop first (conservative)
      if (cfg.dis !== null && s.l[j]! <= entry * (1 - cfg.dis)) {
        realized += remaining * (-cfg.dis - fee);
        remaining = 0; reason = 'stop'; exitIdx = j; break;
      }
      if (!hitTp1 && s.h[j]! >= entry * (1 + cfg.tp1)) {
        realized += cfg.p1 * (cfg.tp1 - fee); remaining -= cfg.p1; hitTp1 = true;
      }
      if (hitTp1 && !hitTp2 && remaining > 0 && s.h[j]! >= entry * (1 + cfg.tp2)) {
        realized += remaining * (cfg.tp2 - fee); remaining = 0; hitTp2 = true; reason = 'tp2'; exitIdx = j; break;
      }
    }
    // time stop on remainder at close of exitIdx
    if (remaining > 0) {
      const tret = (s.c[exitIdx]! - entry) / entry;
      realized += remaining * (tret - fee);
      if (reason === 'time' && hitTp1) reason = 'tp1+time';
    }
    tickets.push({ sym: s.sym, ret: realized, hitTp1, hitTp2, reason });
    i = exitIdx + 1; // no overlapping tickets per coin
  }
  return tickets;
}

const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = (a: number[]) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : 0;

function summarize(cfg: Cfg, tickets: Ticket[], nCoins: number) {
  const rets = tickets.map((t) => t.ret);
  const wins = rets.filter((r) => r > 0).length;
  const wr = rets.length ? wins / rets.length : 0;
  const totalPnl = rets.reduce((a, b) => a + b, 0) * STAKE; // each ticket is STAKE
  const bankroll = STAKE * nCoins; // fixed lottery bankroll = 1 ticket worth per coin
  const yrs = 2.7;
  console.log(`── ${cfg.label}`);
  console.log(
    `   tickets ${tickets.length} (~${(tickets.length / yrs / nCoins).toFixed(1)}/coin/yr) | win ${(wr * 100).toFixed(0)}% | ` +
    `mean/ticket ${(mean(rets) * 100 >= 0 ? '+' : '') + (mean(rets) * 100).toFixed(1)}% | median ${(median(rets) * 100 >= 0 ? '+' : '') + (median(rets) * 100).toFixed(1)}% | ` +
    `best ${(Math.max(...rets) * 100).toFixed(0)}% worst ${(Math.min(...rets) * 100).toFixed(0)}%`,
  );
  console.log(
    `   hit tp1 ${(tickets.filter((t) => t.hitTp1).length / tickets.length * 100).toFixed(0)}% | hit tp2 ${(tickets.filter((t) => t.hitTp2).length / tickets.length * 100).toFixed(0)}% | ` +
    `total PnL $${totalPnl.toFixed(0)} on $${bankroll} bankroll = ${(totalPnl / bankroll * 100).toFixed(0)}% over ~${yrs}y (flat sizing)`,
  );
}

async function main() {
  const coins: Series[] = [];
  for (const sym of UNIVERSE) { const s = await fetchDaily(sym); if (s) coins.push(s); process.stdout.write(`${sym}${s ? '' : '(skip)'} `); }
  console.log(`\n\nUniverse: ${coins.length}/${UNIVERSE.length} | flat $${STAKE}/ticket, fee 0.05%/side\n`);

  const base = { feePerSide: 0.05 };
  const CONFIGS: Cfg[] = [
    { label: 'A. deep entry, 50% @+15 / rest @+30, hold 14d, NO stop', rsiMax: 30, dropDays: 10, dropPct: -0.25, tp1: 0.15, p1: 0.5, tp2: 0.30, maxHold: 14, dis: null, ...base },
    { label: 'B. deep entry, 50% @+20 / rest @+40, hold 21d, NO stop', rsiMax: 30, dropDays: 10, dropPct: -0.25, tp1: 0.20, p1: 0.5, tp2: 0.40, maxHold: 21, dis: null, ...base },
    { label: 'C. deep entry, 50% @+15 / rest @+30, hold 21d, stop -40%', rsiMax: 30, dropDays: 10, dropPct: -0.25, tp1: 0.15, p1: 0.5, tp2: 0.30, maxHold: 21, dis: 0.40, ...base },
    { label: 'D. RELAXED entry (incl ATM), 50% @+15 / rest @+30, hold 14d, NO stop', rsiMax: 35, dropDays: 10, dropPct: -0.15, tp1: 0.15, p1: 0.5, tp2: 0.30, maxHold: 14, dis: null, ...base },
    { label: 'E. deep entry, 33% @+15 / rest @+50, hold 30d, NO stop (let runner ride)', rsiMax: 30, dropDays: 10, dropPct: -0.25, tp1: 0.15, p1: 0.34, tp2: 0.50, maxHold: 30, dis: null, ...base },
    { label: 'F. BUY&HOLD oversold-deep, exit close +14d (no ladder, benchmark)', rsiMax: 30, dropDays: 10, dropPct: -0.25, tp1: 99, p1: 0, tp2: 99, maxHold: 14, dis: null, ...base },
  ];

  console.log('=== LOTTERY STRATEGY — small-cap basket (33 coins), D1 ~2.7y ===\n');
  for (const cfg of CONFIGS) {
    const all: Ticket[] = [];
    for (const s of coins) all.push(...runCoin(s, cfg));
    summarize(cfg, all, coins.length);
    console.log('');
  }

  // Per-target breakdown for the recommended config (D — relaxed, covers ATM)
  const rec = CONFIGS[3]!;
  console.log(`=== Per-coin (recommended config D) on ATM / PIVX / ORDI ===`);
  for (const s of coins.filter((x) => TARGETS.includes(x.sym))) {
    const t = runCoin(s, rec);
    const rets = t.map((x) => x.ret);
    console.log(
      `${s.sym.padEnd(6)} tickets ${String(t.length).padStart(2)} | win ${(rets.filter((r) => r > 0).length / (t.length || 1) * 100).toFixed(0)}% | ` +
      `mean ${(mean(rets) * 100 >= 0 ? '+' : '') + (mean(rets) * 100).toFixed(1)}% | total $${(rets.reduce((a, b) => a + b, 0) * STAKE).toFixed(0)} on $${STAKE} stake`,
    );
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
