/**
 * P5 — Backtest harness for tracking-coin limit orders.
 *
 * Walk-forward replay (NO lookahead): at each historical D1 close it rebuilds the
 * exact production signal snapshot using only candles up to that point, generates
 * swing + day-trade orders with the REAL core functions, then scores them on the
 * candles that came AFTER. Reuses computeSwing/DayTradeLimitOrder + evaluateLimitOrder
 * so it measures the live logic, not a copy.
 *
 * Run:
 *   pnpm --filter worker backtest:orders -- --days=180 --symbols=BTC,ETH
 *   pnpm --filter worker backtest:orders -- --days=365 --swing-min-rr=1.5 --csv=/tmp/bt.csv
 *
 * Known approximation: m30Trend is proxied by h4Trend (fetching M30 over the whole
 * window is heavy and its weight in the score is small). Documented in the P5 doc.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import {
  computeSmallCapSignal,
  computeTimeframeTrend,
  computeLongShortScore,
  calculateRsi,
  calcUtBotResult,
  calculateAtr,
  computeSwingLimitOrder,
  evaluateLimitOrder,
} from '@app/core';
import type { OrderSigSnapshot, LimitOrderResult, PaTrend } from '@app/core';
import { createTrackingCoinsRepository } from '@app/db';

import { BinanceMarketDataService } from '../modules/market/binance-market-data.service';
import type { BinanceKlineDto } from '../modules/market/dto/binance-kline.dto';

// ── Constants (mirror production scan + expiry windows) ────────────────────────
// Day-trade was removed from tracking-coins; this harness backtests SWING only.
const WARMUP_D1 = 210;
const H4_PER_DAY = 6;
const SWING_FWD_DAYS = 5;   // = SWING_EXPIRY_DAYS
const SWING_FWD = SWING_FWD_DAYS * H4_PER_DAY;  // 30 H4 bars
const DAY_MS = 86_400_000;

// ── CLI args ──────────────────────────────────────────────────────────────────
// w1: weekly-alignment filter — only keep a swing order whose side agrees with the
// W1 bias. 'utbot' = UT Bot W1 direction, 'trend' = weekTrend up/down, 'both' = AND.
type W1Mode = 'off' | 'utbot' | 'trend' | 'both';
type SideMode = 'both' | 'long' | 'short';
type Args = { days: number; symbols: string[] | null; swingMinRr: number | null; csv: string | null; w1: W1Mode; side: SideMode; riskPct: number };

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : null;
  };
  const num = (v: string | null) => (v == null || v === '' ? null : Number(v));
  const w1raw = (get('w1') ?? 'off') as W1Mode;
  const w1: W1Mode = (['off', 'utbot', 'trend', 'both'] as const).includes(w1raw) ? w1raw : 'off';
  const sideRaw = (get('side') ?? 'both') as SideMode;
  const side: SideMode = (['both', 'long', 'short'] as const).includes(sideRaw) ? sideRaw : 'both';
  return {
    days: num(get('days')) ?? 180,
    symbols: get('symbols')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) ?? null,
    swingMinRr: num(get('swing-min-rr')),
    csv: get('csv'),
    w1,
    side,
    riskPct: num(get('risk-pct')) ?? 2,
  };
}

// ── Kline helpers ───────────────────────────────────────────────────────────
type Tf = '1d' | '4h' | '1w';
const high = (k: BinanceKlineDto) => parseFloat(k[2]);
const low = (k: BinanceKlineDto) => parseFloat(k[3]);
const close = (k: BinanceKlineDto) => parseFloat(k[4]);
const vol = (k: BinanceKlineDto) => parseFloat(k[5]);
const closeTime = (k: BinanceKlineDto) => k[6];

async function fetchHistory(binance: BinanceMarketDataService, symbol: string, tf: Tf, fromMs: number): Promise<BinanceKlineDto[]> {
  const out: BinanceKlineDto[] = [];
  let start = fromMs;
  const now = Date.now();
  for (let page = 0; page < 60; page++) {
    const batch = await binance.fetchKlines({ symbol, timeframe: tf as never, limit: 1000, startTime: start });
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 1000) break;
    start = closeTime(batch[batch.length - 1]!) + 1;
    if (start > now) break;
  }
  // dedupe by openTime, keep ascending
  const seen = new Set<number>();
  return out.filter((k) => (seen.has(k[0]) ? false : (seen.add(k[0]), true)));
}

// ── Snapshot reconstruction (mirrors TrackingCoinScanService.scanOne) ──────────
function buildSnapshot(
  d1C: number[], d1H: number[], d1L: number[], d1V: number[],
  h4C: number[], h4H: number[], h4L: number[],
): { snap: OrderSigSnapshot; price: number } | null {
  const result = computeSmallCapSignal(d1C, d1H, d1L, d1V);
  if (!result) return null;

  const h4Trend = h4C.length >= 20 ? computeTimeframeTrend(h4C, h4H, h4L) : 'Neutral';
  const m30Trend = h4Trend; // APPROX (see header)
  const h4LastClose = h4C[h4C.length - 1] ?? 0;

  const h4Rsi = h4C.length > 14 ? calculateRsi(h4C, 14) : null;

  const d1Candles = d1C.map((c, i) => ({ open: c, high: d1H[i]!, low: d1L[i]!, close: c }));
  const utBotD1Bullish = calcUtBotResult(d1Candles, 1, 3)?.uptrend ?? null;
  const h4Candles = h4C.length >= 2 ? h4C.map((c, i) => ({ open: c, high: h4H[i]!, low: h4L[i]!, close: c })) : [];
  const utBotH4Bullish = h4Candles.length >= 2 ? (calcUtBotResult(h4Candles, 1, 3)?.uptrend ?? null) : null;

  const { longScore, shortScore } = computeLongShortScore({
    closes: d1C, highs: d1H, lows: d1L,
    rsi: result.rsi, volMultiplier: result.volMultiplier,
    ema34Above: result.ema34Above, ema89Above: result.ema89Above, ema200Above: result.ema200Above,
    d1Trend: result.trend as PaTrend, h4Trend: h4Trend as PaTrend, m30Trend: m30Trend as PaTrend,
    sparkline: result.sparkline,
  });

  return {
    price: h4LastClose,
    snap: {
      trend: result.trend, h4Trend, m30Trend,
      utBotD1Bullish, utBotH4Bullish,
      // null so core's built-in W1 gate is a no-op here — the harness controls the
      // weekly filter externally via the --w1 flag (keeps it an independent measure).
      utBotW1Bullish: null,
      longScore, shortScore,
      ema200Above: result.ema200Above,
      rsi: result.rsi, h4Rsi,
      swingStructure: result.swingStructure,
    },
  };
}

// ── W1 (weekly) alignment filter ───────────────────────────────────────────────
// Mirrors TrackingCoinScanService: utBotW1 = calcUtBotResult(wCandles, 10, 2),
// weekTrend = computeTimeframeTrend. Built from weekly candles closed by T only.
type W1Bias = { utBot: boolean | null; trend: string };

function buildW1Bias(wC: number[], wH: number[], wL: number[]): W1Bias {
  const trend = wC.length >= 20 ? computeTimeframeTrend(wC, wH, wL) : 'Neutral';
  const wCandles = wC.length >= 2 ? wC.map((c, i) => ({ open: c, high: wH[i]!, low: wL[i]!, close: c })) : [];
  const utBot = wCandles.length >= 2 ? (calcUtBotResult(wCandles, 10, 2)?.uptrend ?? null) : null;
  return { utBot, trend };
}

// Returns true if the order side is allowed under the W1 filter. Null/neutral W1
// signals do NOT block (insufficient data shouldn't silently kill the sample).
function passesW1(side: 'LONG' | 'SHORT', mode: W1Mode, w1: W1Bias): boolean {
  if (mode === 'off') return true;
  const t = w1.trend.toLowerCase();
  const trendOk =
    side === 'LONG' ? !t.includes('down') : !t.includes('up');
  const utBotOk =
    w1.utBot == null ? true : side === 'LONG' ? w1.utBot === true : w1.utBot === false;
  if (mode === 'utbot') return utBotOk;
  if (mode === 'trend') return trendOk;
  return utBotOk && trendOk; // both
}

// ── Metrics ───────────────────────────────────────────────────────────────────
type Trade = { side: 'LONG' | 'SHORT'; outcome: 'tp1' | 'tp2' | 'sl' | 'expired'; activated: boolean; r: number; t: number };

function gate(order: LimitOrderResult | null, minRr: number | null): LimitOrderResult | null {
  if (!order) return null;
  if (minRr != null && order.rrRatio < minRr) return null;
  return order;
}

function rOf(order: LimitOrderResult, outcome: 'tp1' | 'tp2' | 'sl' | 'expired'): number {
  const entryMid = (order.entryLow + order.entryHigh) / 2;
  const risk = Math.abs(entryMid - order.sl) || 1e-9;
  if (outcome === 'sl') return -1;
  if (outcome === 'expired') return 0;
  const tp = outcome === 'tp2' && order.tp2 != null ? order.tp2 : order.tp1;
  return Math.abs(tp - entryMid) / risk;
}

type Bucket = { trades: number; unfilled: number; wins: number; losses: number; expired: number; sumPos: number; sumNeg: number; rs: number[] };
const emptyBucket = (): Bucket => ({ trades: 0, unfilled: 0, wins: 0, losses: 0, expired: 0, sumPos: 0, sumNeg: 0, rs: [] });

function add(b: Bucket, t: Trade) {
  // Never-filled limits are not positions — exclude from win-rate/expectancy.
  if (!t.activated) { b.unfilled++; return; }
  b.trades++;
  if (t.outcome === 'sl') { b.losses++; b.sumNeg += 1; }
  else if (t.outcome === 'expired') { b.expired++; }   // held to expiry, exit ≈ flat (0R)
  else { b.wins++; b.sumPos += t.r; }
  b.rs.push(t.r);
}

function maxDrawdown(rs: number[]): number {
  let peak = 0, equity = 0, mdd = 0;
  for (const r of rs) { equity += r; peak = Math.max(peak, equity); mdd = Math.min(mdd, equity - peak); }
  return mdd;
}

function fmtBucket(name: string, b: Bucket): string {
  const resolved = b.wins + b.losses;
  const wr = resolved > 0 ? (b.wins / resolved) * 100 : 0;
  const exp = b.rs.length > 0 ? b.rs.reduce((s, r) => s + r, 0) / b.rs.length : 0;
  const pf = b.sumNeg > 0 ? b.sumPos / b.sumNeg : (b.sumPos > 0 ? Infinity : 0);
  return [
    name.padEnd(18),
    `filled=${String(b.trades).padStart(4)}`,
    `unfill=${String(b.unfilled).padStart(4)}`,
    `W/L=${b.wins}/${b.losses}`.padEnd(11),
    `exp=${b.expired}`.padEnd(7),
    `win%=${wr.toFixed(1).padStart(5)}`,
    `E[R]=${exp.toFixed(3).padStart(7)}`,
    `PF=${(pf === Infinity ? '∞' : pf.toFixed(2)).padStart(5)}`,
    `MDD=${maxDrawdown(b.rs).toFixed(1).padStart(6)}R`,
  ].join('  ');
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const binance = new BinanceMarketDataService();

  let symbols = args.symbols;
  if (!symbols || symbols.length === 0) {
    const repo = createTrackingCoinsRepository();
    symbols = (await repo.findAllCoins()).map((c) => c.symbol);
  }
  if (symbols.length === 0) { console.error('No symbols to backtest.'); process.exit(1); }

  console.log(`\nBacktest tracking-coin SWING orders — days=${args.days}, symbols=${symbols.length}`);
  console.log(`swing minRR=${args.swingMinRr ?? '—'}  (m30Trend≈h4Trend)\n`);

  console.log(`W1 filter: ${args.w1}\n`);

  const all: Trade[] = [];
  let noTradeBars = 0, testedBars = 0, w1FilteredBars = 0;
  const perSymbol: Record<string, Bucket> = {};

  for (const sym of symbols) {
    const bs = `${sym}USDT`;
    const symBucket = emptyBucket();
    try {
      const [d1, h4, w1] = await Promise.all([
        fetchHistory(binance, bs, '1d', Date.now() - (WARMUP_D1 + args.days + 10) * DAY_MS),
        fetchHistory(binance, bs, '4h', Date.now() - (args.days + 40) * DAY_MS),
        fetchHistory(binance, bs, '1w', Date.now() - (args.days + 220 * 7) * DAY_MS),
      ]);
      if (d1.length < WARMUP_D1 + 5) { console.log(`${sym.padEnd(6)} skipped (insufficient D1 history: ${d1.length})`); continue; }

      const d1C = d1.map(close), d1H = d1.map(high), d1L = d1.map(low), d1V = d1.map(vol);

      for (let i = WARMUP_D1 - 1; i < d1.length; i++) {
        const T = closeTime(d1[i]!);
        // up-to-T slices (no lookahead) — candle fully closed by T
        const h4Up = h4.filter((k) => closeTime(k) <= T);
        if (h4Up.length < 200) continue;

        const snap = buildSnapshot(
          d1C.slice(0, i + 1), d1H.slice(0, i + 1), d1L.slice(0, i + 1), d1V.slice(0, i + 1),
          h4Up.map(close), h4Up.map(high), h4Up.map(low),
        );
        if (!snap) continue;
        testedBars++;

        const h4H = h4Up.map(high), h4L = h4Up.map(low), h4C = h4Up.map(close);
        const atrH4 = calculateAtr(h4H, h4L, h4C, 14);

        const swing = gate(computeSwingLimitOrder(snap.price, h4H, h4L, snap.snap, atrH4), args.swingMinRr);
        if (!swing) { noTradeBars++; continue; }

        // Side filter — only trade LONG or only SHORT.
        if (args.side !== 'both' && swing.side.toLowerCase() !== args.side) continue;

        // W1 alignment filter (experiment #1) — drop orders fighting the weekly bias.
        if (args.w1 !== 'off') {
          const wUp = w1.filter((k) => closeTime(k) <= T);
          const w1Bias = buildW1Bias(wUp.map(close), wUp.map(high), wUp.map(low));
          if (!passesW1(swing.side, args.w1, w1Bias)) { w1FilteredBars++; continue; }
        }

        const fwd = h4.filter((k) => closeTime(k) > T).slice(0, SWING_FWD);
        const ev = evaluateLimitOrder(swing.side, swing.entryLow, swing.entryHigh, swing.tp1, swing.tp2 ?? null, swing.sl, fwd.map(high), fwd.map(low));
        let outcome: Trade['outcome'] | null = ev.outcome;
        if (!outcome) {
          if (fwd.length >= SWING_FWD) outcome = 'expired';  // full window elapsed, no TP/SL
          else continue;                                      // window not complete yet → still running
        }
        const tr: Trade = { side: swing.side, outcome, activated: ev.activated, r: ev.activated ? rOf(swing, outcome) : 0, t: T };
        all.push(tr);
        add(symBucket, tr);
      }
      perSymbol[sym] = symBucket;
      console.log(fmtBucket(sym, symBucket));
    } catch (err) {
      console.log(`${sym.padEnd(6)} ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Aggregate report ──
  const bySide: Record<string, Bucket> = { 'swing LONG': emptyBucket(), 'swing SHORT': emptyBucket() };
  const overall = emptyBucket();
  for (const t of all) { add(overall, t); add(bySide[`swing ${t.side}`]!, t); }

  console.log('\n── Breakdown ───────────────────────────────────────────────────────────────');
  for (const k of ['swing LONG', 'swing SHORT']) {
    if (bySide[k]!.trades > 0) console.log(fmtBucket(k, bySide[k]!));
  }
  console.log('────────────────────────────────────────────────────────────────────────────');
  console.log(fmtBucket('OVERALL', overall));
  const noTradePct = testedBars > 0 ? (noTradeBars / testedBars) * 100 : 0;
  console.log(`\nTested bars: ${testedBars}  |  No-trade bars (regime gate / minRR): ${noTradeBars} (${noTradePct.toFixed(1)}%)  |  W1-filtered: ${w1FilteredBars}`);

  // ── Plain-language money summary ($1000 start, fixed-fractional risk) ──────────
  const filledTrades = all.filter((t) => t.activated);
  const wins = filledTrades.filter((t) => t.outcome === 'tp1' || t.outcome === 'tp2').length;
  const losses = filledTrades.filter((t) => t.outcome === 'sl').length;
  const flats = filledTrades.filter((t) => t.outcome === 'expired').length;
  const decided = wins + losses;
  const winPct = decided > 0 ? (wins / decided) * 100 : 0;

  const START = 1000;
  let equity = START;
  for (const t of filledTrades) {           // chronological per symbol
    equity += t.r * (equity * args.riskPct / 100);
  }
  const profit = equity - START;
  const retPct = (profit / START) * 100;

  console.log('\n══ KẾT QUẢ DỄ HIỂU ══════════════════════════════════════════════════════════');
  console.log(`Tổng số lệnh đã vào (khớp):  ${filledTrades.length}`);
  console.log(`  • Thắng (chạm TP):         ${wins}`);
  console.log(`  • Thua  (chạm SL):         ${losses}`);
  console.log(`  • Hòa   (hết hạn, ~0):     ${flats}`);
  console.log(`Tỷ lệ thắng (bỏ qua hòa):    ${winPct.toFixed(1)}%  (${wins} thắng / ${decided} lệnh có kết quả)`);
  console.log(`\nNếu bắt đầu $${START}, mỗi lệnh rủi ro ${args.riskPct}% số dư (chưa trừ phí):`);
  console.log(`  → Số dư cuối:  $${equity.toFixed(0)}   (${profit >= 0 ? '+' : ''}$${profit.toFixed(0)}, ${retPct >= 0 ? '+' : ''}${retPct.toFixed(0)}%)`);
  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log('E[R] = expectancy per order in R (SL=-1). PF = profit factor. MDD = max drawdown in R.\n');

  if (args.csv) {
    const rows = ['time,side,activated,outcome,r', ...all.map((t) => `${new Date(t.t).toISOString()},${t.side},${t.activated},${t.outcome},${t.r.toFixed(4)}`)];
    fs.writeFileSync(args.csv, rows.join('\n'));
    console.log(`Wrote ${all.length} trades → ${args.csv}\n`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
