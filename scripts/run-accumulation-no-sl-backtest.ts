/**
 * Backtest: ENTER IN THE ACCUMULATION ZONE, spot, NO stop-loss (user's real flow).
 *
 *   - Accumulation zone = coin DOWN [ddMin,ddMax] from its `peakLookback`-day peak
 *     AND in a tight sideways base (range ≤ rangeMaxPct over rangeLen)
 *     AND price sitting in the LOWER part of that base (≤ rangeLow×(1+lowZone)).
 *   - Entry: buy LONG at close inside the base (spot). NO stop-loss.
 *   - Exit: price RECLAIMS EMA34 on close (the take-profit reclaim) → sell all.
 *           Optional hard target: also exit if +targetPct reached first.
 *   - Never reclaims by end of data → position left OPEN, marked-to-market ("bag held").
 *   - One campaign per coin at a time; $capital compounded per coin; fee per side both ways.
 *   - Tracks MAE (deepest drawdown while holding) — the real risk when there is no SL.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-accumulation-no-sl-backtest.ts \
 *     [days] [capital] [feePctPerSide] [ddMin] [ddMax] [rangeLen] [rangeMaxPct] \
 *     [lowZone] [rsiMax] [exitEma] [targetPct] [peakLookback]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

const BASKET = [
  'BTC', 'ETH', 'ADA', 'SOL', 'TAO', 'SEI', 'BNB', 'XRP', 'DOGE', 'ZEC',
  'XLM', 'LINK', 'BCH', 'HBAR', 'LTC', 'SUI', 'AVAX', 'SHIB', 'NEAR', 'WLFI',
  'UNI', 'WLD', 'ASTER', 'ONDO', 'DOT', 'AAVE', 'ICP', 'ETC', 'PEPE', 'ATOM',
  'ENA', 'POL', 'FIL', 'APT', 'ARB', 'INJ',
].map((s) => `${s}USDT`);

type Candle = { high: number; low: number; close: number; volume: number; openTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    let batch: unknown[][];
    try { batch = (await fetchJson(url)) as unknown[][]; } catch { break; }
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      out.push({ high: parseFloat(k[2] as string), low: parseFloat(k[3] as string), close: parseFloat(k[4] as string), volume: parseFloat(k[5] as string), openTime: new Date(k[0] as number) });
    }
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

function fmt(n: number, d = 2): string { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }

// EMA series aligned to closes (closes[i] → ema[i]); seeded with SMA(period).
function emaSeries(closes: number[], period: number): number[] {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  let sma = 0;
  for (let i = 0; i < period; i++) sma += closes[i]!;
  sma /= period;
  out[period - 1] = sma;
  for (let i = period; i < closes.length; i++) out[i] = closes[i]! * k + out[i - 1] * (1 - k);
  return out;
}

function rsiSeries(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(ch, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

type Cfg = {
  ddMin: number; ddMax: number; rangeLen: number; rangeMaxPct: number;
  lowZone: number; rsiMax: number; exitEma: number; targetPct: number;
  peakLookback: number; feePerSide: number; capital: number;
};

type Camp = { symbol: string; entry: number; exit: number; entryTime: Date; exitTime: Date; reason: 'reclaim' | 'target' | 'open'; retPct: number; maePct: number; bars: number };

function runCoin(symbol: string, candles: Candle[], cfg: Cfg): { camps: Camp[]; finalEquity: number } {
  const closes = candles.map((c) => c.close);
  const ema34 = emaSeries(closes, cfg.exitEma);
  const rsi = rsiSeries(closes, 14);
  const fee = cfg.feePerSide / 100;
  const camps: Camp[] = [];
  let equity = cfg.capital;

  let pos: { entry: number; entryTime: Date; entryIdx: number; mae: number } | null = null;
  const warmup = Math.max(cfg.peakLookback, cfg.rangeLen, cfg.exitEma) + 1;

  const close = (exit: number, t: Date, reason: Camp['reason'], i: number) => {
    const gross = (exit - pos!.entry) / pos!.entry;
    const net = gross - 2 * fee;
    equity *= 1 + net;
    camps.push({ symbol, entry: pos!.entry, exit, entryTime: pos!.entryTime, exitTime: t, reason, retPct: net, maePct: pos!.mae * 100, bars: i - pos!.entryIdx });
    pos = null;
  };

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;

    if (pos) {
      const dd = (pos.entry - c.low) / pos.entry; // how far underwater intra-candle
      if (dd > pos.mae) pos.mae = dd;
      if (cfg.targetPct > 0 && c.high >= pos.entry * (1 + cfg.targetPct)) { close(pos.entry * (1 + cfg.targetPct), c.openTime, 'target', i); continue; }
      if (!isNaN(ema34[i]!) && c.close >= ema34[i]!) { close(c.close, c.openTime, 'reclaim', i); continue; }
      continue; // still holding (no SL)
    }

    // ── accumulation-zone entry test ──
    let rangeHigh = -Infinity, rangeLow = Infinity, peak = -Infinity;
    for (let j = i - cfg.rangeLen; j < i; j++) { if (candles[j]!.high > rangeHigh) rangeHigh = candles[j]!.high; if (candles[j]!.low < rangeLow) rangeLow = candles[j]!.low; }
    for (let j = i - cfg.peakLookback; j < i; j++) if (candles[j]!.high > peak) peak = candles[j]!.high;

    const dd = peak > 0 ? (peak - c.close) / peak : 0;
    const baseWidth = rangeLow > 0 ? (rangeHigh - rangeLow) / rangeLow : Infinity;
    const inLowerBase = c.close <= rangeLow * (1 + cfg.lowZone);
    const rsiOk = cfg.rsiMax >= 100 || (!isNaN(rsi[i]!) && rsi[i]! <= cfg.rsiMax);
    const belowEma = isNaN(ema34[i]!) || c.close < ema34[i]!; // don't buy if already reclaimed

    if (dd >= cfg.ddMin && dd <= cfg.ddMax && baseWidth <= cfg.rangeMaxPct && inLowerBase && rsiOk && belowEma) {
      pos = { entry: c.close, entryTime: c.openTime, entryIdx: i, mae: 0 };
    }
  }

  if (pos) {
    const last = candles[candles.length - 1]!;
    const gross = (last.close - pos.entry) / pos.entry;
    const net = gross - 2 * fee;
    equity *= 1 + net;
    camps.push({ symbol, entry: pos.entry, exit: last.close, entryTime: pos.entryTime, exitTime: last.openTime, reason: 'open', retPct: net, maePct: pos.mae * 100, bars: candles.length - 1 - pos.entryIdx });
  }
  return { camps, finalEquity: equity };
}

async function main() {
  const a = process.argv.slice(2);
  const days = Number(a[0] ?? 1460);
  const capital = Number(a[1] ?? 1000);
  const feePerSide = Number(a[2] ?? 0.05);
  const ddMin = Number(a[3] ?? 0.6);
  const ddMax = Number(a[4] ?? 0.8);
  const rangeLen = Number(a[5] ?? 30);
  const rangeMaxPct = Number(a[6] ?? 0.25);
  const lowZone = Number(a[7] ?? 0.08);
  const rsiMax = Number(a[8] ?? 45);
  const exitEma = Number(a[9] ?? 34);
  const targetPct = Number(a[10] ?? 0); // 0 = reclaim-only exit
  const peakLookback = Number(a[11] ?? 365);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${BASKET.length} coins, D1, ${days}d ...`);
  const data: Record<string, Candle[]> = {};
  for (const sym of BASKET) {
    const c = await fetchKlines(sym, '1d', startMs, endMs);
    if (c.length >= peakLookback + rangeLen + 10) data[sym] = c;
    process.stdout.write(`${sym}:${c.length} `);
  }
  console.log('\n');

  const cfg: Cfg = { ddMin, ddMax, rangeLen, rangeMaxPct, lowZone, rsiMax, exitEma, targetPct, peakLookback, feePerSide, capital };
  console.log(`=== ACCUMULATION-ZONE ENTRY, NO STOP-LOSS | D1 | $${capital}/coin compounded | fee ${feePerSide}%/side ===`);
  console.log(`    dd ${ddMin}-${ddMax} from ${peakLookback}d peak | base ${rangeLen}d ≤${rangeMaxPct * 100}% | buy ≤low+${lowZone * 100}% | RSI≤${rsiMax} | exit reclaim EMA${exitEma}${targetPct > 0 ? ` or +${targetPct * 100}%` : ''}`);
  console.log(`    coins with data: ${Object.keys(data).length}/${BASKET.length}\n`);

  const all: Camp[] = [];
  const finals: number[] = [];
  const perCoin: { sym: string; n: number; win: number; open: number; avgRet: number; worstMae: number; final: number }[] = [];
  for (const [sym, candles] of Object.entries(data)) {
    const { camps, finalEquity } = runCoin(sym, candles, cfg);
    if (camps.length === 0) continue;
    all.push(...camps);
    finals.push(finalEquity);
    const wins = camps.filter((c) => c.retPct > 0).length;
    const open = camps.filter((c) => c.reason === 'open').length;
    perCoin.push({ sym, n: camps.length, win: wins, open, avgRet: camps.reduce((s, c) => s + c.retPct, 0) / camps.length * 100, worstMae: Math.max(...camps.map((c) => c.maePct)), final: finalEquity });
  }

  perCoin.sort((x, y) => y.final - x.final);
  console.log('symbol     | camps | win | open | winRate | avgRet% | worstMAE% | final$');
  for (const p of perCoin) {
    console.log(`${p.sym.padEnd(10)} | ${String(p.n).padStart(5)} | ${String(p.win).padStart(3)} | ${String(p.open).padStart(4)} | ${fmt(p.n ? p.win / p.n * 100 : 0).padStart(6)}% | ${(p.avgRet >= 0 ? '+' : '') + fmt(p.avgRet)}% | ${fmt(p.worstMae).padStart(8)}% | ${('$' + fmt(p.final)).padStart(10)}`);
  }

  const n = all.length;
  const wins = all.filter((c) => c.retPct > 0);
  const openN = all.filter((c) => c.reason === 'open').length;
  const grossW = wins.reduce((s, c) => s + c.retPct, 0);
  const grossL = all.filter((c) => c.retPct <= 0).reduce((s, c) => s + Math.abs(c.retPct), 0);
  const er = n ? all.reduce((s, c) => s + c.retPct, 0) / n : 0;
  const avgMae = n ? all.reduce((s, c) => s + c.maePct, 0) / n : 0;
  const worstMae = n ? Math.max(...all.map((c) => c.maePct)) : 0;
  const avgBars = n ? all.reduce((s, c) => s + c.bars, 0) / n : 0;
  const avgFinal = finals.length ? finals.reduce((x, y) => x + y, 0) / finals.length : capital;
  console.log(`\nTOTAL: ${n} camps | winRate ${fmt(n ? wins.length / n * 100 : 0)}% | E[R] ${(er * 100 >= 0 ? '+' : '') + fmt(er * 100)}% | PF ${grossL > 0 ? fmt(grossW / grossL) : '∞'} | still-open ${openN}`);
  console.log(`       avg MAE ${fmt(avgMae)}% | worst MAE ${fmt(worstMae)}% | avg hold ${fmt(avgBars, 0)}d | avg$/coin $${fmt(avgFinal)}`);
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
