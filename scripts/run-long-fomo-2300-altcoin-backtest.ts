/**
 * LONG "FOMO" intraday backtest — ALTCOINS ONLY.
 * Entry LONG at 23:00 UTC (06:00 Vietnam), TP +2%, force-close at 15:00 UTC (22:00 Vietnam).
 *
 * Rule (every day):
 *   - Entry: LONG at the OPEN of the 23:00 UTC 1h candle. Fixed $notional/trade (NO compounding).
 *   - TP   : +tpPct%. If any candle in the holding window [23:00 .. just before 15:00 next day]
 *            trades up to entry×(1+tp), exit at TP.
 *   - No stop-loss. If TP not hit, FORCE CLOSE at 15:00 UTC next day = open of the 15:00 candle.
 *   - One trade per day. Holding window crosses midnight (23 -> 15 = 16 hours).
 *
 * Fee feePct%/side (round-trip 2× fee). Reports net $ P&L (sum of fixed-size trades).
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-long-fomo-2300-altcoin-backtest.ts \
 *   [days] [feePctPerSide] [notional] [tpPct]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const INTERVAL = '1h';
const SYMBOLS = ['TAOUSDT', 'BNBUSDT', 'POLUSDT', 'XRPUSDT', 'SOLUSDT', 'SUIUSDT', 'ARBUSDT'];
const MAX_HOLD = 24;    // safety: window may span up to ~16h, allow margin for data gaps

type Candle = { open: number; high: number; low: number; close: number; hour: number };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = []; let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), hour: new Date(k[0] as number).getUTCHours() });
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));

type Res = { trades: number; tpHits: number; forced: number; forcedWin: number; net: number; grossWin: number; grossLoss: number };

function run(c: Candle[], notional: number, feePct: number, tpPct: number, exitHour: number, entryHour: number): Res {
  const f = feePct / 100, tp = tpPct / 100;
  const r: Res = { trades: 0, tpHits: 0, forced: 0, forcedWin: 0, net: 0, grossWin: 0, grossLoss: 0 };
  for (let i = 0; i < c.length; i++) {
    if (c[i]!.hour !== entryHour) continue;
    const entry = c[i]!.open, tpPx = entry * (1 + tp);
    let exitRet: number | null = null, hitTP = false;
    for (let j = i; j < c.length; j++) {
      if (j > i && c[j]!.hour === exitHour) { exitRet = (c[j]!.open - entry) / entry; break; } // force close at exit-hour open
      if (c[j]!.high >= tpPx) { exitRet = tp; hitTP = true; break; }                            // TP hit intra-candle
      if (j - i > MAX_HOLD) { exitRet = (c[j]!.close - entry) / entry; break; }                  // safety (data gap)
    }
    if (exitRet === null) continue;
    const grossPnl = notional * exitRet;
    const netPnl = notional * ((1 + exitRet) * (1 - f) * (1 - f) - 1);
    r.trades++; r.net += netPnl;
    if (grossPnl >= 0) r.grossWin += grossPnl; else r.grossLoss += -grossPnl;
    if (hitTP) r.tpHits++; else { r.forced++; if (exitRet >= 0) r.forcedWin++; }
  }
  return r;
}

async function main() {
  const [, , daysA, feeA, notA, tpA, ehA, entryA] = process.argv;
  const days = Number(daysA ?? 365), fee = Number(feeA ?? 0.05), notional = Number(notA ?? 100), tpPct = Number(tpA ?? 2), exitHour = Number(ehA ?? 8);
  // entryArg: single hour "0" or sweep range "0-2" (default sweep 0..2)
  const entryArg = entryA ?? '0-2';
  const entryHours = entryArg.includes('-')
    ? (() => { const [a, b] = entryArg.split('-').map(Number); const out: number[] = []; for (let h = a!; h <= b!; h++) out.push(h); return out; })()
    : [Number(entryArg)];
  const vnExit = (exitHour + 7) % 24;
  const endMs = Date.now(), startMs = endMs - days * 864e5;

  console.log(`\n=== LONG entry sweep · TP +${tpPct}% · force-close @ ${String(exitHour).padStart(2, '0')}:00 UTC (${String(vnExit).padStart(2, '0')}:00 VN) · NO stop · ${INTERVAL} · ${days}d · $${notional}/trade fixed · fee ${fee}%/side ===`);

  // fetch each symbol once, reuse across entry-hour sweep
  const data: Record<string, Candle[]> = {};
  for (const sym of SYMBOLS) data[sym] = await fetchKlines(sym, INTERVAL, startMs, endMs);

  for (const eh of entryHours) {
    const vnEntry = (eh + 7) % 24;
    console.log(`\n--- ENTRY @ ${String(eh).padStart(2, '0')}:00 UTC (${String(vnEntry).padStart(2, '0')}:00 VN) ---`);
    console.log('  symbol     | trades | TP hit | forced | forcedWin | TP% |   NET $   | avg$/trade');
    let T: Res = { trades: 0, tpHits: 0, forced: 0, forcedWin: 0, net: 0, grossWin: 0, grossLoss: 0 };
    for (const sym of SYMBOLS) {
      const c = data[sym]!;
      if (c.length === 0) { console.log(`  ${sym.padEnd(10)} | (no data)`); continue; }
      const r = run(c, notional, fee, tpPct, exitHour, eh);
      const tpRate = r.trades ? (r.tpHits / r.trades) * 100 : 0;
      console.log(
        `  ${sym.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.tpHits).padStart(6)} | ${String(r.forced).padStart(6)} | ${String(r.forcedWin).padStart(9)} | ` +
          `${(fmt(tpRate, 0) + '%').padStart(4)} | ${usd(r.net).padStart(9)} | ${usd(r.trades ? r.net / r.trades : 0).padStart(8)}`,
      );
      T.trades += r.trades; T.tpHits += r.tpHits; T.forced += r.forced; T.forcedWin += r.forcedWin; T.net += r.net;
    }
    console.log(`  TOTAL: ${T.trades} trades · TP hit ${T.tpHits} (${fmt(T.trades ? (T.tpHits / T.trades) * 100 : 0, 1)}%) · forced ${T.forced} (${T.forcedWin} green) · NET ${usd(T.net)} · avg ${usd(T.trades ? T.net / T.trades : 0)}/trade`);
  }
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
