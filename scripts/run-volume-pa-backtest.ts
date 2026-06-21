/**
 * Price-Action + Volume backtest — H4, both directions.
 *
 * Signal candle = a reversal PA pattern CONFIRMED by a volume spike (vol > volMult × SMA(vol,volLen)):
 *   LONG  : bullish engulfing OR hammer (long lower wick, small body up top)
 *   SHORT : bearish engulfing OR shooting star (long upper wick, small body down low)
 *
 * Entry: at the CLOSE of the signal candle.
 * SL   : long → signalLow ×(1−buf); short → signalHigh ×(1+buf).
 * TP   : fixed reward:risk → entry ± rr × |entry − SL|.
 * Exit : first SL/TP touch intra-candle (SL-first if both same candle). One position at a time.
 *
 * Capital: $startCap compounded, full position each trade, fee feePct%/side.
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-volume-pa-backtest.ts \
 *   [days] [feePctPerSide] [startCap] [volMult] [volLen] [rr] [slBufPct] [dir(long|short|both)]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const INTERVAL = '4h';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];

type Candle = { open: number; high: number; low: number; close: number; vol: number };

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
    for (const k of batch) out.push({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), vol: +(k[5] as string) });
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

function volSma(c: Candle[], len: number): number[] {
  const out = new Array(c.length).fill(0); let s = 0;
  for (let i = 0; i < c.length; i++) { s += c[i]!.vol; if (i >= len) s -= c[i - len]!.vol; if (i >= len - 1) out[i] = s / len; }
  return out;
}

const body = (c: Candle) => Math.abs(c.close - c.open);
const upWick = (c: Candle) => c.high - Math.max(c.open, c.close);
const loWick = (c: Candle) => Math.min(c.open, c.close) - c.low;
const isBull = (c: Candle) => c.close > c.open;
const isBear = (c: Candle) => c.close < c.open;

function bullishEngulf(p: Candle, c: Candle) { return isBull(c) && isBear(p) && c.close >= p.open && c.open <= p.close; }
function bearishEngulf(p: Candle, c: Candle) { return isBear(c) && isBull(p) && c.close <= p.open && c.open >= p.close; }
function hammer(c: Candle) { const b = body(c); return b > 0 && loWick(c) >= 2 * b && upWick(c) <= b; }
function shootingStar(c: Candle) { const b = body(c); return b > 0 && upWick(c) >= 2 * b && loWick(c) <= b; }

type Cfg = { volMult: number; volLen: number; rr: number; slBufPct: number; dir: 'long' | 'short' | 'both' };
type Res = { trades: number; wins: number; losses: number; longs: number; shorts: number; retPct: number; maxDD: number; sumR: number };

function run(c: Candle[], startCap: number, feePct: number, cfg: Cfg): Res {
  const vma = volSma(c, cfg.volLen);
  const f = feePct / 100, buf = cfg.slBufPct / 100;
  let eq = startCap, peak = startCap, maxDD = 0;
  let trades = 0, wins = 0, losses = 0, longs = 0, shorts = 0, sumR = 0;
  let i = cfg.volLen;
  while (i < c.length - 1) {
    const cur = c[i]!, prev = c[i - 1]!;
    if (vma[i]! <= 0 || cur.vol < cfg.volMult * vma[i]!) { i++; continue; }
    let side: 'long' | 'short' | null = null;
    if ((cfg.dir === 'long' || cfg.dir === 'both') && (bullishEngulf(prev, cur) || hammer(cur))) side = 'long';
    else if ((cfg.dir === 'short' || cfg.dir === 'both') && (bearishEngulf(prev, cur) || shootingStar(cur))) side = 'short';
    if (!side) { i++; continue; }

    const entry = cur.close;
    const sl = side === 'long' ? cur.low * (1 - buf) : cur.high * (1 + buf);
    const risk = Math.abs(entry - sl);
    if (risk <= 0) { i++; continue; }
    const tp = side === 'long' ? entry + cfg.rr * risk : entry - cfg.rr * risk;

    let exitPx = c[c.length - 1]!.close, exitIdx = c.length - 1, outcome: 'tp' | 'sl' | 'eod' = 'eod';
    for (let j = i + 1; j < c.length; j++) {
      const hitSL = side === 'long' ? c[j]!.low <= sl : c[j]!.high >= sl;
      const hitTP = side === 'long' ? c[j]!.high >= tp : c[j]!.low <= tp;
      if (hitSL) { exitPx = sl; exitIdx = j; outcome = 'sl'; break; } // SL-first if both
      if (hitTP) { exitPx = tp; exitIdx = j; outcome = 'tp'; break; }
    }

    const grossRet = side === 'long' ? (exitPx - entry) / entry : (entry - exitPx) / entry;
    const netMult = (1 + grossRet) * (1 - f) * (1 - f);
    eq += eq * netMult - eq;
    trades++; if (side === 'long') longs++; else shorts++;
    if (outcome === 'tp' || (outcome === 'eod' && grossRet >= 0)) wins++; else losses++;
    sumR += (side === 'long' ? exitPx - entry : entry - exitPx) / risk;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak);
    i = exitIdx + 1; // no overlapping trades
  }
  return { trades, wins, losses, longs, shorts, retPct: (eq / startCap - 1) * 100, maxDD: maxDD * 100, sumR };
}

async function main() {
  const [, , daysA, feeA, capA, vmA, vlA, rrA, bufA, dirA] = process.argv;
  const days = Number(daysA ?? 365), fee = Number(feeA ?? 0.05), cap = Number(capA ?? 1000);
  const cfg: Cfg = { volMult: Number(vmA ?? 1.5), volLen: Number(vlA ?? 20), rr: Number(rrA ?? 2), slBufPct: Number(bufA ?? 0.1), dir: (dirA as Cfg['dir']) ?? 'both' };
  const endMs = Date.now(), startMs = endMs - days * 864e5;

  console.log(`\n=== PRICE ACTION + VOLUME — ${cfg.dir.toUpperCase()} · ${INTERVAL} · ${days}d · $${cap} compounded · fee ${fee}%/side ===`);
  console.log(`signals: engulfing + hammer/star · volume > ${cfg.volMult}× SMA(${cfg.volLen}) · TP=${cfg.rr}R · SLbuf=${cfg.slBufPct}%`);
  console.log('\n  symbol     | trades |  L /  S | win  | loss | winRate |  return%  | maxDD% | avgR');
  let T = { trades: 0, wins: 0, sumR: 0 };
  for (const sym of SYMBOLS) {
    const c = await fetchKlines(sym, INTERVAL, startMs, endMs);
    const r = run(c, cap, fee, cfg);
    const wr = r.trades ? (r.wins / r.trades) * 100 : 0;
    const avgR = r.trades ? r.sumR / r.trades : 0;
    console.log(
      `  ${sym.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.longs).padStart(2)} /${String(r.shorts).padStart(3)} | ` +
        `${String(r.wins).padStart(4)} | ${String(r.losses).padStart(4)} | ${(fmt(wr, 1) + '%').padStart(7)} | ${(fmt(r.retPct, 1) + '%').padStart(9)} | ${fmt(r.maxDD, 1).padStart(6)} | ${fmt(avgR, 2).padStart(5)}`,
    );
    T.trades += r.trades; T.wins += r.wins; T.sumR += r.sumR;
  }
  console.log(`\n  TOTAL: ${T.trades} trades · winRate ${fmt(T.trades ? (T.wins / T.trades) * 100 : 0, 1)}% · avgR ${fmt(T.trades ? T.sumR / T.trades : 0, 2)} (expectancy/trade in R)\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
