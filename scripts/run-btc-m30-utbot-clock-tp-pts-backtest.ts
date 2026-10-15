/**
 * BTC · M30 UT Bot directional clock — fixed-point TP, hard time exit, NO stop.
 *
 * Every UTC day:
 *   - Read the M30 UT Bot (ATR period 10, key value kv) on the last CLOSED M30 candle (23:30,
 *     which closes at 00:00): close > trailing stop → LONG, else SHORT.
 *   - Enter at the OPEN of the 00:00 UTC M30 candle.
 *   - TP = entry ± tpPts, filled intra-candle when high/low reaches it.
 *   - No stop-loss. Force-close at the OPEN of the exitHour UTC candle (default 20:00).
 * Fee feePct%/side. P&L in USD per 1 BTC (= price points); % of account assumes 1x, full account.
 * Also reports MAE (worst open drawdown inside each trade) since there is no stop.
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-btc-m30-utbot-clock-tp-pts-backtest.ts \
 *   [startISO=2024-01-01] [tpPts=500] [exitHour=20] [kv=3] [feePctPerSide=0.05]
 */
import * as https from 'https';

const BAR_MS = 30 * 60 * 1000, DAY_MS = 864e5;
type C = { t: number; o: number; h: number; l: number; c: number };

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (x) => (d += x)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetchKlines(startMs: number, endMs: number): Promise<C[]> {
  const out: C[] = []; let cur = startMs;
  while (cur < endMs) {
    const batch = (await fetchJson(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=30m&startTime=${cur}&endTime=${endMs}&limit=1000`)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ t: k[0] as number, o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string) });
    if (batch.length < 1000) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out.filter((x) => x.t + BAR_MS <= Date.now());
}

/** UT Bot Alerts trailing stop (Wilder ATR) — same as packages/core/src/indicators/ut-bot.ts. */
function utBotStop(c: C[], period: number, mult: number): number[] {
  const atr = new Array(c.length).fill(0), stop = new Array(c.length).fill(0);
  const tr = c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c))));
  let sum = 0; for (let i = 0; i < Math.min(period, c.length); i++) sum += tr[i]!;
  if (c.length >= period) atr[period - 1] = sum / period;
  for (let i = period; i < c.length; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  for (let i = 0; i < c.length; i++) {
    const close = c[i]!.c, nLoss = atr[i]! * mult;
    if (nLoss === 0) continue;
    const ps = i > 0 ? stop[i - 1]! : 0, pc = i > 0 ? c[i - 1]!.c : 0;
    if (close > ps && pc > ps) stop[i] = Math.max(ps, close - nLoss);
    else if (close < ps && pc < ps) stop[i] = Math.min(ps, close + nLoss);
    else if (close > ps) stop[i] = close - nLoss;
    else stop[i] = close + nLoss;
  }
  return stop;
}

type Trade = { t: number; side: 'L' | 'S'; entry: number; exit: number; tp: boolean; pts: number; net: number; mae: number };

function run(c: C[], startMs: number, tpPts: number, exitHour: number, kv: number, fee: number, mode: 'ut' | 'long' | 'short' = 'ut'): Trade[] {
  const stop = utBotStop(c, 10, kv);
  const f = fee / 100, out: Trade[] = [];
  for (let i = 1; i < c.length; i++) {
    const b = c[i]!;
    if (b.t < startMs || b.t % DAY_MS !== 0) continue; // 00:00 UTC candles only
    const prev = c[i - 1]!;
    if (prev.t !== b.t - BAR_MS || stop[i - 1] === 0) continue;
    const side: 'L' | 'S' = mode === 'long' ? 'L' : mode === 'short' ? 'S' : prev.c > stop[i - 1]! ? 'L' : 'S';
    const entry = b.o, tpPx = side === 'L' ? entry + tpPts : entry - tpPts;
    const exitT = b.t + exitHour * 3600e3;
    let exit: number | null = null, tp = false, mae = 0;
    for (let k = i; k < c.length; k++) {
      const x = c[k]!;
      if (x.t >= exitT) { exit = x.o; break; }
      if (side === 'L') { if (x.h >= tpPx) { mae = Math.max(mae, entry - x.l); exit = tpPx; tp = true; break; } mae = Math.max(mae, entry - x.l); }
      else { if (x.l <= tpPx) { mae = Math.max(mae, x.h - entry); exit = tpPx; tp = true; break; } mae = Math.max(mae, x.h - entry); }
    }
    if (exit === null) continue; // today's trade still open
    const pts = side === 'L' ? exit - entry : entry - exit;
    out.push({ t: b.t, side, entry, exit, tp, pts, net: pts - (entry + exit) * f, mae: Math.max(0, mae) });
  }
  return out;
}

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (n: number, d = 0) => (n >= 0 ? '+' : '-') + fmt(Math.abs(n), d);
const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))]! : 0; };

function line(label: string, tr: Trade[]): string {
  const n = tr.length, tpN = tr.filter((x) => x.tp).length, win = tr.filter((x) => x.net > 0).length;
  const gross = tr.reduce((s, x) => s + x.pts, 0), net = tr.reduce((s, x) => s + x.net, 0);
  const cmpG = (tr.reduce((a, x) => a * (1 + x.pts / x.entry), 1) - 1) * 100, cmpN = (tr.reduce((a, x) => a * (1 + x.net / x.entry), 1) - 1) * 100;
  let e = 1, pk = 1, dd = 0; for (const x of tr) { e *= 1 + x.pts / x.entry; pk = Math.max(pk, e); dd = Math.max(dd, (pk - e) / pk); }
  const forced = tr.filter((x) => !x.tp), worst = Math.min(...tr.map((x) => x.pts));
  const L = tr.filter((x) => x.side === 'L').length;
  return `  ${label.padEnd(24)}| ${`${n} (${L}/${n - L})`.padStart(11)} | TP ${fmt((tpN / n) * 100).padStart(2)}% | win ${fmt((win / n) * 100).padStart(2)}% | forced avg ${sgn(forced.reduce((s, x) => s + x.pts, 0) / (forced.length || 1)).padStart(5)} | worst ${sgn(worst).padStart(6)} | gross ${sgn(gross).padStart(7)} (${sgn(cmpG, 1)}%) | NET ${sgn(net).padStart(8)} (${sgn(cmpN, 1)}%) | grossDD ${fmt(dd * 100, 1)}%`;
}

async function main() {
  const [, , startA, tpA, exA, kvA, feeA] = process.argv;
  const startMs = Date.parse(startA ?? '2024-01-01T00:00:00Z');
  const tpPts = Number(tpA ?? 500), exitHour = Number(exA ?? 20), kv = Number(kvA ?? 3), fee = Number(feeA ?? 0.05);
  const c = await fetchKlines(startMs - 30 * DAY_MS, Date.now());

  console.log(`\n=== BTCUSDT · M30 UT Bot(10,${kv}) clock · entry 00:00 UTC open · TP ${tpPts} pts · force-close ${exitHour}:00 UTC · NO stop · fee ${fee}%/side ===`);
  console.log(`    ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(c[c.length - 1]!.t).toISOString().slice(0, 16)} UTC · P&L USD per 1 BTC; (%) = account, 1x full account, compounded\n`);

  const main = run(c, startMs, tpPts, exitHour, kv, fee);
  console.log('  config                  | trades(L/S) |  TP%  |  win% | forced avg  | worst   | gross (acct%)            | NET (acct%)                | grossDD');
  console.log(line(`MAIN kv${kv} TP${tpPts} exit${exitHour}`, main));
  console.log(line('always LONG (no filter)', run(c, startMs, tpPts, exitHour, kv, fee, 'long')));
  console.log(line('always SHORT (no filter)', run(c, startMs, tpPts, exitHour, kv, fee, 'short')));
  for (const k of [1, 2, 3, 4]) if (k !== kv) console.log(line(`kv${k}`, run(c, startMs, tpPts, exitHour, k, fee)));
  for (const tp of [300, 700, 1000, 1500]) console.log(line(`TP ${tp}`, run(c, startMs, tp, exitHour, kv, fee)));
  for (const ex of [4, 8, 13]) console.log(line(`exit ${ex}:00 UTC`, run(c, startMs, tpPts, ex, kv, fee)));

  const mae = main.map((x) => x.mae);
  console.log(`\n  MAIN MAE (worst open loss inside a trade, pts): median ${fmt(q(mae, 0.5))} · p75 ${fmt(q(mae, 0.75))} · p90 ${fmt(q(mae, 0.9))} · p95 ${fmt(q(mae, 0.95))} · max ${fmt(Math.max(...mae))}`);
  console.log(`  trades that were ≥1000 pts under water at some point: ${mae.filter((m) => m >= 1000).length} · ≥2000: ${mae.filter((m) => m >= 2000).length} · ≥3000: ${mae.filter((m) => m >= 3000).length}`);

  console.log(`\n  MAIN by year / side`);
  for (const y of [...new Set(main.map((x) => new Date(x.t).getUTCFullYear()))]) for (const s of ['L', 'S'] as const) {
    const tr = main.filter((x) => new Date(x.t).getUTCFullYear() === y && x.side === s);
    if (!tr.length) continue;
    console.log(`    ${y} ${s === 'L' ? 'LONG ' : 'SHORT'} ${String(tr.length).padStart(3)} trades · TP ${fmt((tr.filter((x) => x.tp).length / tr.length) * 100)}% · gross ${sgn(tr.reduce((a, x) => a + x.pts, 0)).padStart(7)} · net ${sgn(tr.reduce((a, x) => a + x.net, 0)).padStart(7)}`);
  }
  console.log(`\n  MAIN worst 5 trades`);
  for (const x of [...main].sort((a, b) => a.pts - b.pts).slice(0, 5)) console.log(`    ${new Date(x.t).toISOString().slice(0, 10)} ${x.side === 'L' ? 'LONG ' : 'SHORT'} @${fmt(x.entry, 1)} → ${fmt(x.exit, 1)} ${sgn(x.pts)} (MAE ${fmt(x.mae)})`);
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
