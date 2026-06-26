/**
 * RANGE / MEAN-REVERSION backtest — BTC 15m (fade the edges of a sideways box).
 *
 * Idea: the live /day-trading bot is breakout/trend, so it stands aside in chop.
 * This is the COMPLEMENT — it only trades when price is ranging, and fades the
 * band edges back toward the middle.
 *
 * Rule (per bar i, decided on the CLOSE of bar i; SL/TP simulated from i+1 fwd):
 *   Regime gate (must be ranging, else skip):
 *     - ADX(14) < adxMax            → no trend
 *     - Donchian(N) width / price ≥ minWidthPct (room to fade), N = prior N bars
 *   Entry (fade):
 *     - pos = (close − donLow)/(donHigh − donLow)
 *     - LONG  if pos ≤ edge AND RSI(14) < (50−rsiBand) AND bar is bullish (close>open)
 *     - SHORT if pos ≥ 1−edge AND RSI(14) > (50+rsiBand) AND bar is bearish (close<open)
 *   Stop / target:
 *     - LONG  SL = donLow  − slAtr×ATR ;  TP = mid (or opposite edge donHigh)
 *     - SHORT SL = donHigh + slAtr×ATR ;  TP = mid (or opposite edge donLow)
 *   Exit: SL or TP touch (SL checked first within a bar = pessimistic), else
 *         time-stop after maxBars → exit at that close.
 *   One position at a time, flat between. Fee feePct%/side (round-trip = 2×).
 *   Sizing: fixed riskUsd lost at SL; position size = riskUsd / |entry−SL|.
 *   Outcome scored in R (= pnl$/riskUsd, net of fees) and in $.
 *
 * Sweeps a grid of (adxMax × edge) so you can see where, if anywhere, the edge is.
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-range-meanrev-btc-15m-backtest.ts \
 *   [days] [feePctPerSide] [riskUsd] [donchianN] [minWidthPct] [rsiBand] [slAtrMult] [maxBars] [tpMode]
 *   tpMode = "mid" (default) | "opp"
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const SYMBOL = 'BTCUSDT';
const INTERVAL = '15m';
const DAY_MS = 864e5;

type Candle = { open: number; high: number; low: number; close: number; t: number };

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
    for (const k of batch) out.push({ t: k[0] as number, open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string) });
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}
const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));

function wilderAtr(c: Candle[], p: number): number[] {
  const n = c.length;
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close))));
  const atr = new Array(n).fill(0); let s = 0;
  for (let i = 0; i < p; i++) s += tr[i]!;
  atr[p - 1] = s / p;
  for (let i = p; i < n; i++) atr[i] = (atr[i - 1]! * (p - 1) + tr[i]!) / p;
  return atr;
}
function wilderRsi(c: Candle[], p: number): number[] {
  const n = c.length, rsi = new Array(n).fill(50);
  let ag = 0, al = 0;
  for (let i = 1; i <= p; i++) { const ch = c[i]!.close - c[i - 1]!.close; if (ch >= 0) ag += ch; else al -= ch; }
  ag /= p; al /= p;
  rsi[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < n; i++) {
    const ch = c[i]!.close - c[i - 1]!.close;
    ag = (ag * (p - 1) + Math.max(ch, 0)) / p;
    al = (al * (p - 1) + Math.max(-ch, 0)) / p;
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return rsi;
}
function wilderAdx(c: Candle[], p: number): number[] {
  const n = c.length, adx = new Array(n).fill(0);
  const tr = new Array(n).fill(0), pDM = new Array(n).fill(0), mDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = c[i]!.high - c[i - 1]!.high, dn = c[i - 1]!.low - c[i]!.low;
    pDM[i] = up > dn && up > 0 ? up : 0;
    mDM[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(c[i]!.high - c[i]!.low, Math.abs(c[i]!.high - c[i - 1]!.close), Math.abs(c[i]!.low - c[i - 1]!.close));
  }
  let trS = 0, pS = 0, mS = 0;
  for (let i = 1; i <= p; i++) { trS += tr[i]!; pS += pDM[i]!; mS += mDM[i]!; }
  const dx: number[] = new Array(n).fill(0);
  const calcDx = (ps: number, ms: number, trs: number) => { const pdi = 100 * (ps / trs), mdi = 100 * (ms / trs); const s = pdi + mdi; return s === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / s; };
  dx[p] = calcDx(pS, mS, trS);
  for (let i = p + 1; i < n; i++) {
    trS = trS - trS / p + tr[i]!; pS = pS - pS / p + pDM[i]!; mS = mS - mS / p + mDM[i]!;
    dx[i] = calcDx(pS, mS, trS);
  }
  // ADX = Wilder smoothing of DX, first value at 2p
  let sum = 0;
  for (let i = p; i < 2 * p; i++) sum += dx[i]!;
  adx[2 * p - 1] = sum / p;
  for (let i = 2 * p; i < n; i++) adx[i] = (adx[i - 1]! * (p - 1) + dx[i]!) / p;
  return adx;
}

type Cfg = { adxMax: number; edge: number };
type Res = { trades: number; wins: number; tp: number; sl: number; timeout: number; totalR: number; net: number; grossWin: number; grossLoss: number };

function run(c: Candle[], atr: number[], rsi: number[], adx: number[], donN: number, minWidthPct: number, rsiBand: number, slAtr: number, maxBars: number, tpMode: string, feePct: number, riskUsd: number, winStartMs: number, cfg: Cfg, entryMode = 'edge'): Res {
  const f = feePct / 100;
  const r: Res = { trades: 0, wins: 0, tp: 0, sl: 0, timeout: 0, totalR: 0, net: 0, grossWin: 0, grossLoss: 0 };
  const warm = Math.max(donN + 1, 28);
  let i = warm;
  while (i < c.length) {
    if (c[i]!.t < winStartMs) { i++; continue; }
    if (adx[i]! <= 0 || adx[i]! >= cfg.adxMax) { i++; continue; }       // must be ranging
    // Donchian over PRIOR donN bars (exclude current → no lookahead).
    let donHigh = -Infinity, donLow = Infinity;
    for (let k = i - donN; k < i; k++) { if (c[k]!.high > donHigh) donHigh = c[k]!.high; if (c[k]!.low < donLow) donLow = c[k]!.low; }
    const width = donHigh - donLow;
    if (width <= 0) { i++; continue; }
    const price = c[i]!.close;
    if (width / price < minWidthPct / 100) { i++; continue; }            // range too tight → skip
    const pos = (price - donLow) / width;
    const mid = (donHigh + donLow) / 2;
    const bull = c[i]!.close > c[i]!.open, bear = c[i]!.close < c[i]!.open;

    let dir: 1 | -1 | 0 = 0, sl = 0, tp = 0;
    if (entryMode === 'reclaim') {
      // Failed-breakout: this bar WICKED beyond the band but CLOSED back inside.
      const pokeDown = c[i]!.low < donLow && c[i]!.close > donLow && bull && rsi[i]! < 50 - rsiBand;
      const pokeUp = c[i]!.high > donHigh && c[i]!.close < donHigh && bear && rsi[i]! > 50 + rsiBand;
      if (pokeDown) { dir = 1; sl = c[i]!.low - slAtr * atr[i]!; tp = tpMode === 'opp' ? donHigh : mid; }
      else if (pokeUp) { dir = -1; sl = c[i]!.high + slAtr * atr[i]!; tp = tpMode === 'opp' ? donLow : mid; }
    } else if (pos <= cfg.edge && rsi[i]! < 50 - rsiBand && bull) {
      dir = 1; sl = donLow - slAtr * atr[i]!; tp = tpMode === 'opp' ? donHigh : mid;
    } else if (pos >= 1 - cfg.edge && rsi[i]! > 50 + rsiBand && bear) {
      dir = -1; sl = donHigh + slAtr * atr[i]!; tp = tpMode === 'opp' ? donLow : mid;
    }
    if (dir === 0) { i++; continue; }
    const entry = price, riskDist = Math.abs(entry - sl);
    if (riskDist <= 0 || (dir === 1 && tp <= entry) || (dir === -1 && tp >= entry)) { i++; continue; }
    const size = riskUsd / riskDist;          // BTC units; loses exactly riskUsd at SL (pre-fee)

    // Simulate forward from i+1.
    let exitPx: number | null = null, kind: 'tp' | 'sl' | 'timeout' = 'timeout';
    let j = i + 1;
    for (; j < c.length && j <= i + maxBars; j++) {
      const bar = c[j]!;
      if (dir === 1) {
        if (bar.low <= sl) { exitPx = sl; kind = 'sl'; break; }          // SL first (pessimistic)
        if (bar.high >= tp) { exitPx = tp; kind = 'tp'; break; }
      } else {
        if (bar.high >= sl) { exitPx = sl; kind = 'sl'; break; }
        if (bar.low <= tp) { exitPx = tp; kind = 'tp'; break; }
      }
    }
    if (exitPx === null) { const last = Math.min(i + maxBars, c.length - 1); if (last <= i) break; exitPx = c[last]!.close; kind = 'timeout'; j = last; }

    const grossPnl = dir * (exitPx - entry) * size;
    const fees = (entry + exitPx) * size * f;  // fee per side on notional, both sides
    const net = grossPnl - fees;
    r.trades++; r.net += net; r.totalR += net / riskUsd;
    if (net > 0) { r.wins++; r.grossWin += net; } else r.grossLoss -= net;
    if (kind === 'tp') r.tp++; else if (kind === 'sl') r.sl++; else r.timeout++;
    i = j + 1;                                  // flat between trades; resume after exit bar
  }
  return r;
}

async function main() {
  const [, , daysA, feeA, riskA, donA, widthA, rsiBandA, slAtrA, maxBarsA, tpModeA] = process.argv;
  const days = Number(daysA ?? 365), fee = Number(feeA ?? 0.05), riskUsd = Number(riskA ?? 5);
  const donN = Number(donA ?? 24), minWidthPct = Number(widthA ?? 0.8), rsiBand = Number(rsiBandA ?? 15);
  const slAtr = Number(slAtrA ?? 0.3), maxBars = Number(maxBarsA ?? 96), tpMode = (tpModeA ?? 'mid');
  const entryMode = process.argv[11] ?? 'edge';   // 'edge' | 'reclaim'

  const endMs = Date.now(), winStartMs = endMs - days * DAY_MS, warmStartMs = winStartMs - 5 * DAY_MS;
  console.log(`\nFetching ${SYMBOL} ${INTERVAL} …`);
  const c = await fetchKlines(SYMBOL, INTERVAL, warmStartMs, endMs);
  console.log(`  ${c.length} candles (${new Date(c[0]!.t).toISOString().slice(0, 10)} → ${new Date(c[c.length - 1]!.t).toISOString().slice(0, 10)})`);
  const atr = wilderAtr(c, 14), rsi = wilderRsi(c, 14), adx = wilderAdx(c, 14);

  console.log(`\n=== RANGE MEAN-REVERSION · ${SYMBOL} ${INTERVAL} · ${days}d · entry ${entryMode} · Donchian${donN} · minWidth ${minWidthPct}% · RSI band ±${rsiBand} · SL ${slAtr}×ATR · TP ${tpMode} · maxHold ${maxBars} bars (${(maxBars / 4).toFixed(0)}h) · fee ${fee}%/side · risk $${riskUsd}/trade ===\n`);
  console.log('  adxMax | edge | trades | TP  | SL  | t/o | winRate |  totalR | exp(R) |  PF  |   NET $   ');
  console.log('  -------+------+--------+-----+-----+-----+---------+---------+--------+------+-----------');

  const adxGrid = [18, 22, 25, 100];   // 100 = ADX filter effectively OFF
  const edgeGrid = [0.10, 0.15, 0.20];
  let best: { cfg: Cfg; r: Res } | null = null;
  for (const adxMax of adxGrid) {
    for (const edge of edgeGrid) {
      const r = run(c, atr, rsi, adx, donN, minWidthPct, rsiBand, slAtr, maxBars, tpMode, fee, riskUsd, winStartMs, { adxMax, edge }, entryMode);
      const wr = r.trades ? (r.wins / r.trades) * 100 : 0;
      const pf = r.grossLoss > 0 ? r.grossWin / r.grossLoss : r.grossWin > 0 ? Infinity : 0;
      const exp = r.trades ? r.totalR / r.trades : 0;
      console.log(
        `  ${String(adxMax).padStart(6)} | ${edge.toFixed(2)} | ${String(r.trades).padStart(6)} | ${String(r.tp).padStart(3)} | ${String(r.sl).padStart(3)} | ${String(r.timeout).padStart(3)} | ` +
        `${(fmt(wr, 1) + '%').padStart(7)} | ${fmt(r.totalR, 1).padStart(7)} | ${fmt(exp, 3).padStart(6)} | ${(pf === Infinity ? '∞' : fmt(pf, 2)).padStart(4)} | ${usd(r.net).padStart(9)}`,
      );
      if (r.trades >= 20 && (!best || r.net > best.r.net)) best = { cfg: { adxMax, edge }, r };
    }
  }
  if (best) {
    const { cfg, r } = best;
    console.log(`\n  BEST (≥20 trades): adxMax ${cfg.adxMax} · edge ${cfg.edge.toFixed(2)} → ${r.trades} trades · winRate ${fmt(r.trades ? (r.wins / r.trades) * 100 : 0, 1)}% · totalR ${fmt(r.totalR, 1)} · exp ${fmt(r.trades ? r.totalR / r.trades : 0, 3)}R · NET ${usd(r.net)}\n`);
  } else {
    console.log('\n  No config produced ≥20 trades.\n');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
