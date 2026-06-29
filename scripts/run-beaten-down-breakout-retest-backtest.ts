/**
 * Backtest the user's 5-step "beaten-down breakout-retest" strategy.
 *
 *   1. Coin is DOWN 60–80% from its peak AND going sideways (tight base).
 *   2. Volume pattern confirms the move (on-chain skipped for v1 — price+volume only).
 *   3. Resistance zone = the HIGH of the consolidation base.
 *   4. Breakout: a D1 candle CLOSES above resistance with volume > volMult × avgVol.
 *   5. Entry: wait for price to RETEST the broken resistance (now support), enter LONG there.
 *
 * Risk: SL below the consolidation low, TP at `rr`×risk. Long-only (recovery play).
 * One position at a time per coin, $capital compounded PER COIN, fee per side both ways.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-beaten-down-breakout-retest-backtest.ts \
 *     [days] [capital] [feePctPerSide] [ddMin] [ddMax] [rangeLen] [rangeMaxPct] \
 *     [volMult] [brkBuf] [retestWindow] [retestTol] [rrList] [peakLookback]
 *
 *   # defaults: 4y D1, $1000, 0.05%/side, dd 0.60–0.80, base 30d ≤25% wide,
 *   #           vol 1.8×, breakout buffer 1%, retest within 8 candles ±1.5%, rr sweep 1.5/2/3
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-beaten-down-breakout-retest-backtest.ts
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

// The /tracking-coins basket (queried from prod DB 2026-06-29).
const BASKET = [
  'BTC', 'ETH', 'ADA', 'SOL', 'TAO', 'SEI', 'BNB', 'XRP', 'DOGE', 'ZEC',
  'XLM', 'LINK', 'BCH', 'HBAR', 'LTC', 'SUI', 'AVAX', 'SHIB', 'NEAR', 'WLFI',
  'UNI', 'WLD', 'ASTER', 'ONDO', 'DOT', 'AAVE', 'ICP', 'ETC', 'PEPE', 'ATOM',
  'ENA', 'POL', 'FIL', 'APT', 'ARB', 'INJ',
].map((s) => `${s}USDT`);

type Candle = { open: number; high: number; low: number; close: number; volume: number; openTime: Date };

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
    let batch: unknown[][];
    try {
      batch = (await fetchJson(url)) as unknown[][];
    } catch {
      break;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      candles.push({
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        volume: parseFloat(k[5] as string),
        openTime: new Date(k[0] as number),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Cfg = {
  ddMin: number;
  ddMax: number;
  rangeLen: number;
  rangeMaxPct: number;
  volMult: number;
  brkBuf: number;
  retestWindow: number;
  retestTol: number;
  rr: number;
  peakLookback: number;
  feePerSide: number;
  capital: number;
};

type Trade = {
  symbol: string;
  entry: number;
  exit: number;
  entryTime: Date;
  exitTime: Date;
  reason: 'tp' | 'sl' | 'eod';
  retPct: number; // net of fees
};

// State machine per coin. Returns trades + per-coin compounded final equity.
function runCoin(symbol: string, candles: Candle[], cfg: Cfg): { trades: Trade[]; finalEquity: number } {
  const fee = cfg.feePerSide / 100;
  const trades: Trade[] = [];
  let equity = cfg.capital;

  type Armed = { resistance: number; consoLow: number; brokeAt: number };
  let armed: Armed | null = null;
  let pos: { entry: number; entryTime: Date; sl: number; tp: number } | null = null;

  const warmup = Math.max(cfg.peakLookback, cfg.rangeLen) + 1;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;

    // ── 1. Manage open position (SL checked first — conservative) ──
    if (pos) {
      if (c.low <= pos.sl) {
        const gross = (pos.sl - pos.entry) / pos.entry;
        const net = gross - 2 * fee;
        equity *= 1 + net;
        trades.push({ symbol, entry: pos.entry, exit: pos.sl, entryTime: pos.entryTime, exitTime: c.openTime, reason: 'sl', retPct: net });
        pos = null;
      } else if (c.high >= pos.tp) {
        const gross = (pos.tp - pos.entry) / pos.entry;
        const net = gross - 2 * fee;
        equity *= 1 + net;
        trades.push({ symbol, entry: pos.entry, exit: pos.tp, entryTime: pos.entryTime, exitTime: c.openTime, reason: 'tp', retPct: net });
        pos = null;
      }
      if (pos) continue; // still in trade → no new setups this candle
    }

    // ── consolidation window [i-rangeLen .. i-1] ──
    let rangeHigh = -Infinity;
    let rangeLow = Infinity;
    let volSum = 0;
    for (let j = i - cfg.rangeLen; j < i; j++) {
      const w = candles[j]!;
      if (w.high > rangeHigh) rangeHigh = w.high;
      if (w.low < rangeLow) rangeLow = w.low;
      volSum += w.volume;
    }
    const avgVol = volSum / cfg.rangeLen;

    // ── 5. ARMED: wait for retest of broken resistance, then enter LONG ──
    if (armed) {
      const ageOk = i - armed.brokeAt <= cfg.retestWindow;
      const retestLevel = armed.resistance;
      const touched = c.low <= retestLevel * (1 + cfg.retestTol) && c.low >= retestLevel * (1 - cfg.retestTol * 2);
      // give up if price ran away far above without a pullback, or window expired
      const ranAway = c.low > retestLevel * (1 + cfg.retestTol);
      if (touched && ageOk) {
        const entry = retestLevel; // limit fill at the broken level
        const sl = armed.consoLow * 0.99; // below the base
        const risk = entry - sl;
        const tp = entry + cfg.rr * risk;
        pos = { entry, entryTime: c.openTime, sl, tp };
        armed = null;
        continue;
      }
      if (!ageOk || (!touched && !ranAway && i - armed.brokeAt > cfg.retestWindow)) {
        armed = null;
      }
      if (armed && !ageOk) armed = null;
      // if armed and still within window, keep waiting (even if price ran away briefly)
      if (armed && i - armed.brokeAt > cfg.retestWindow) armed = null;
      if (armed) continue;
    }

    // ── SCANNING: look for a new beaten-down breakout to arm ──
    // peak over [i-peakLookback .. i-1]
    let peak = -Infinity;
    for (let j = i - cfg.peakLookback; j < i; j++) {
      if (candles[j]!.high > peak) peak = candles[j]!.high;
    }
    const dd = peak > 0 ? (peak - c.close) / peak : 0; // drawdown fraction
    const ddOk = dd >= cfg.ddMin && dd <= cfg.ddMax;

    const baseWidth = rangeLow > 0 ? (rangeHigh - rangeLow) / rangeLow : Infinity;
    const sideways = baseWidth <= cfg.rangeMaxPct;

    const volOk = c.volume > cfg.volMult * avgVol;
    const breakout = c.close > rangeHigh * (1 + cfg.brkBuf) && volOk;

    if (ddOk && sideways && breakout) {
      armed = { resistance: rangeHigh, consoLow: rangeLow, brokeAt: i };
    }
  }

  if (pos) {
    const last = candles[candles.length - 1]!;
    const gross = (last.close - pos.entry) / pos.entry;
    const net = gross - 2 * fee;
    equity *= 1 + net;
    trades.push({ symbol, entry: pos.entry, exit: last.close, entryTime: pos.entryTime, exitTime: last.openTime, reason: 'eod', retPct: net });
  }

  return { trades, finalEquity: equity };
}

function summarize(label: string, all: Trade[], perCoinFinals: number[], capital: number) {
  const n = all.length;
  const wins = all.filter((t) => t.retPct > 0);
  const winRate = n ? wins.length / n : 0;
  const grossWin = wins.reduce((s, t) => s + t.retPct, 0);
  const grossLoss = all.filter((t) => t.retPct <= 0).reduce((s, t) => s + Math.abs(t.retPct), 0);
  const pf = grossLoss > 0 ? grossWin / grossLoss : Infinity;
  const er = n ? all.reduce((s, t) => s + t.retPct, 0) / n : 0; // expectancy per trade (net %)
  const avgFinal = perCoinFinals.length ? perCoinFinals.reduce((a, b) => a + b, 0) / perCoinFinals.length : capital;
  const sorted = [...perCoinFinals].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : capital;
  console.log(
    `${label.padEnd(22)} | ${String(n).padStart(6)} | ${fmt(winRate * 100).padStart(6)}% | ${(er * 100 >= 0 ? '+' : '') + fmt(er * 100, 2)}% | ${(pf === Infinity ? '∞' : fmt(pf, 2)).padStart(6)} | ${('$' + fmt(avgFinal)).padStart(11)} | ${('$' + fmt(median)).padStart(11)}`,
  );
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
  const volMult = Number(a[7] ?? 1.8);
  const brkBuf = Number(a[8] ?? 0.01);
  const retestWindow = Number(a[9] ?? 8);
  const retestTol = Number(a[10] ?? 0.015);
  const rrList = (a[11] ?? '1.5,2,3').split(',').map(Number);
  const peakLookback = Number(a[12] ?? 365);

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

  console.log(`=== BEATEN-DOWN BREAKOUT-RETEST | D1 | $${capital}/coin compounded | fee ${feePerSide}%/side ===`);
  console.log(`    dd ${ddMin}-${ddMax} from ${peakLookback}d peak | base ${rangeLen}d ≤${rangeMaxPct * 100}% wide | vol ${volMult}× | brkBuf ${brkBuf * 100}% | retest ±${retestTol * 100}% in ${retestWindow}d`);
  console.log(`    coins with data: ${Object.keys(data).length}/${BASKET.length}\n`);

  console.log('rr (TP=rr×risk)        | trades | winRate |  E[R]  |   PF   |   avg$/coin |  median$/coin');
  for (const rr of rrList) {
    const cfg: Cfg = { ddMin, ddMax, rangeLen, rangeMaxPct, volMult, brkBuf, retestWindow, retestTol, rr, peakLookback, feePerSide, capital };
    const all: Trade[] = [];
    const finals: number[] = [];
    const tradedCoins: string[] = [];
    for (const [sym, candles] of Object.entries(data)) {
      const { trades, finalEquity } = runCoin(sym, candles, cfg);
      all.push(...trades);
      if (trades.length > 0) {
        finals.push(finalEquity);
        tradedCoins.push(sym);
      }
    }
    summarize(`rr=${rr}`, all, finals, capital);
    if (rr === rrList[rrList.length - 1]) {
      console.log(`\n  coins that produced ≥1 trade (rr=${rr}): ${tradedCoins.join(', ') || '(none)'}`);
      console.log('  last 10 trades:');
      console.log('  symbol     entry time   dir    entry        exit       reason  ret%');
      for (const t of all.slice(-10)) {
        console.log(`  ${t.symbol.padEnd(9)} ${t.entryTime.toISOString().slice(0, 10)}  LONG   ${fmt(t.entry, 4).padStart(10)}  ${fmt(t.exit, 4).padStart(10)}  ${t.reason.padEnd(6)}  ${(t.retPct * 100 >= 0 ? '+' : '') + fmt(t.retPct * 100)}%`);
      }
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
