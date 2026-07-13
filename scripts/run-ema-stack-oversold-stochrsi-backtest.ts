/**
 * Backtest — "extended-below-EMA-stack oversold StochRSI bounce" (LONG only).
 *
 * User's rule:
 *   LONG entry when a CLOSED candle satisfies ALL of:
 *     1. Bearish EMA stack with price below it:  close < EMA34 < EMA89 < EMA200
 *     2. Price is stretched 7–15% BELOW EMA34:   distMin <= (EMA34-close)/EMA34 <= distMax
 *     3. StochRSI bullish cross in oversold:      %K (yellow) crosses ABOVE its MA (%D)
 *        from below, while in the oversold zone (%K < osLevel at the cross).
 *   Take profit ~10% above entry. (No fixed SL in the base rule — this script also
 *   supports an optional SL % and a max-hold timeout to measure risk.)
 *
 * This is a COUNTER-TREND "catch the falling knife" mean-reversion bounce — the
 * opposite of run-ema-pullback (which needs a BULLISH stack). We therefore also
 * report MAE (max adverse excursion) so the falling-knife risk is visible.
 *
 * One position at a time, flat between setups. $1000 compounded, no leverage.
 * Fee charged on BOTH sides of every round-trip. TP/SL fills assumed at the level.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json \
 *     scripts/run-ema-stack-oversold-stochrsi-backtest.ts \
 *     [symbols] [interval] [days] [capital] [feePctPerSide] [tpPct] [distMin] [distMax] [osLevel] [slPct] [maxHoldBars]
 *   e.g. ... "BTCUSDT,ETHUSDT,SOLUSDT" 4h 730 1000 0.05 10 7 15 20 0 0
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

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
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      candles.push({
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        openTime: new Date(k[0] as number),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

// EMA seeded with an SMA of the first `period` closes.
function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// --- StochRSI (TradingView defaults 14/14/3/3): %K = yellow line, %D = its SMA (MA) ---
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
function sma(values: number[], n: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) continue;
    let s = 0, ok = true;
    for (let j = i - n + 1; j <= i; j++) { const v = values[j]!; if (Number.isNaN(v)) { ok = false; break; } s += v; }
    if (ok) out[i] = s / n;
  }
  return out;
}
function stochRsi(closes: number[], rsiLen = 14, stochLen = 14, smK = 3, smD = 3): { k: number[]; d: number[] } {
  const rsi = rsiSeries(closes, rsiLen);
  const raw: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    let lo = Infinity, hi = -Infinity, ok = true;
    for (let j = i - stochLen + 1; j <= i; j++) {
      if (j < 0) { ok = false; break; }
      const v = rsi[j]!;
      if (Number.isNaN(v)) { ok = false; break; }
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (ok) raw[i] = hi === lo ? 0 : ((rsi[i]! - lo) / (hi - lo)) * 100;
  }
  const k = sma(raw, smK);
  const d = sma(k, smD);
  return { k, d };
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Trade = {
  entry: number;
  exit: number;
  entryTime: Date;
  exitTime: Date;
  retPct: number;      // net of fees
  maePct: number;      // worst intra-trade drawdown from entry (gross)
  barsHeld: number;
  reason: 'tp' | 'sl' | 'timeout' | 'eod';
};

function run(
  candles: Candle[],
  cfg: { tpPct: number; distMin: number; distMax: number; osLevel: number; slPct: number; maxHold: number; feePerSide: number; capital: number },
) {
  const closes = candles.map((c) => c.close);
  const eF = ema(closes, 34);
  const eM = ema(closes, 89);
  const eS = ema(closes, 200);
  const { k, d } = stochRsi(closes);
  const fee = cfg.feePerSide / 100;
  const warmup = 200 + 20; // EMA200 + StochRSI warmup

  const trades: Trade[] = [];
  let equity = cfg.capital;
  let barsInMarket = 0;
  let pos: { entry: number; entryTime: Date; tp: number; sl: number; worstLow: number; bars: number } | null = null;

  const netRet = (entry: number, exit: number) => (exit - entry) / entry - 2 * fee;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const f = eF[i]!, m = eM[i]!, s = eS[i]!;
    if (!isFinite(f) || !isFinite(m) || !isFinite(s)) continue;

    if (pos === null) {
      const stackBelow = c.close < f && f < m && m < s;               // 1) price below bearish stack
      const dist = (f - c.close) / f;                                  // 2) how far below EMA34
      const stretched = dist >= cfg.distMin && dist <= cfg.distMax;
      const ki = k[i]!, di = d[i]!, kp = k[i - 1]!, dp = d[i - 1]!;
      const crossUp = isFinite(ki) && isFinite(di) && isFinite(kp) && isFinite(dp) && kp <= dp && ki > di;
      const oversold = isFinite(ki) && ki < cfg.osLevel;              // 3) cross while oversold
      if (stackBelow && stretched && crossUp && oversold) {
        pos = {
          entry: c.close,
          entryTime: c.openTime,
          tp: c.close * (1 + cfg.tpPct / 100),
          sl: cfg.slPct > 0 ? c.close * (1 - cfg.slPct / 100) : 0,
          worstLow: c.close,
          bars: 0,
        };
      }
      continue;
    }

    barsInMarket++;
    pos.bars++;
    if (c.low < pos.worstLow) pos.worstLow = c.low;

    // priority: SL (conservative) -> TP -> timeout
    if (pos.sl > 0 && c.low <= pos.sl) {
      const r = netRet(pos.entry, pos.sl);
      equity *= 1 + r;
      trades.push({ entry: pos.entry, exit: pos.sl, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, maePct: (pos.worstLow - pos.entry) / pos.entry, barsHeld: pos.bars, reason: 'sl' });
      pos = null;
      continue;
    }
    if (c.high >= pos.tp) {
      const r = netRet(pos.entry, pos.tp);
      equity *= 1 + r;
      trades.push({ entry: pos.entry, exit: pos.tp, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, maePct: (pos.worstLow - pos.entry) / pos.entry, barsHeld: pos.bars, reason: 'tp' });
      pos = null;
      continue;
    }
    if (cfg.maxHold > 0 && pos.bars >= cfg.maxHold) {
      const r = netRet(pos.entry, c.close);
      equity *= 1 + r;
      trades.push({ entry: pos.entry, exit: c.close, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, maePct: (pos.worstLow - pos.entry) / pos.entry, barsHeld: pos.bars, reason: 'timeout' });
      pos = null;
      continue;
    }
  }

  if (pos) {
    const last = candles[candles.length - 1]!;
    const r = netRet(pos.entry, last.close);
    equity *= 1 + r;
    trades.push({ entry: pos.entry, exit: last.close, entryTime: pos.entryTime, exitTime: last.openTime, retPct: r, maePct: (pos.worstLow - pos.entry) / pos.entry, barsHeld: pos.bars, reason: 'eod' });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  const tps = trades.filter((t) => t.reason === 'tp').length;
  let eq = cfg.capital, peak = cfg.capital, maxDD = 0;
  for (const t of trades) { eq *= 1 + t.retPct; if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd; }
  const avgMae = trades.length ? trades.reduce((a, t) => a + t.maePct, 0) / trades.length : 0;
  const worstMae = trades.reduce((a, t) => Math.min(a, t.maePct), 0);
  const avgBars = trades.length ? trades.reduce((a, t) => a + t.barsHeld, 0) / trades.length : 0;

  return {
    trades: trades.length,
    tps,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / cfg.capital - 1) * 100,
    maxDD: maxDD * 100,
    avgMae: avgMae * 100,
    worstMae: worstMae * 100,
    avgBars,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, tpArg, dMinArg, dMaxArg, osArg, slArg, holdArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,DOGEUSDT,DOTUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '4h';
  const days = Number(daysArg ?? 730);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const tpPct = Number(tpArg ?? 10);
  const distMin = Number(dMinArg ?? 7) / 100;
  const distMax = Number(dMaxArg ?? 15) / 100;
  const osLevel = Number(osArg ?? 20);
  const slPct = Number(slArg ?? 0);
  const maxHold = Number(holdArg ?? 0);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  console.log(`\n=== EMA34/89/200 extended-below + StochRSI oversold cross | LONG | ${interval} | ${days}d | $${capital} | fee ${feePerSide}%/side ===`);
  console.log(`TP ${tpPct}% | dist ${(distMin * 100).toFixed(0)}-${(distMax * 100).toFixed(0)}% below EMA34 | osLevel ${osLevel} | SL ${slPct > 0 ? slPct + '%' : 'none'} | maxHold ${maxHold > 0 ? maxHold + ' bars' : 'none'}`);
  console.log('symbol     | trades |  TP | winRate |   final$   | return% | maxDD% | avgMAE% | worstMAE% | avgBars');

  const cfg = { tpPct, distMin, distMax, osLevel, slPct, maxHold, feePerSide, capital };
  const agg: Trade[] = [];
  let totTrades = 0, totTp = 0, totWins = 0;
  for (const symbol of symbols) {
    const candles = await fetchKlines(symbol, interval, startMs, endMs);
    if (!candles.length) { console.log(`${symbol.padEnd(10)} | no data`); continue; }
    const r = run(candles, cfg);
    agg.push(...r.list);
    totTrades += r.trades; totTp += r.tps; totWins += r.list.filter((t) => t.retPct > 0).length;
    console.log(
      `${symbol.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.tps).padStart(3)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${fmt(r.avgMae).padStart(7)} | ${fmt(r.worstMae).padStart(9)} | ${fmt(r.avgBars, 1).padStart(6)}`
    );
  }

  // Pooled per-trade stats (each entry treated independently, equal-weight) — the true edge test.
  if (agg.length) {
    const avgRet = agg.reduce((a, t) => a + t.retPct, 0) / agg.length * 100;
    const medRet = [...agg].map((t) => t.retPct).sort((a, b) => a - b)[Math.floor(agg.length / 2)]! * 100;
    const avgMae = agg.reduce((a, t) => a + t.maePct, 0) / agg.length * 100;
    const worstMae = agg.reduce((a, t) => Math.min(a, t.maePct), 0) * 100;
    console.log(`\n--- POOLED over all symbols (equal-weight per trade) ---`);
    console.log(`  trades ${agg.length} | TP-hit ${((totTp / agg.length) * 100).toFixed(1)}% | winRate ${((totWins / agg.length) * 100).toFixed(1)}%`);
    console.log(`  avg net ret/trade ${avgRet.toFixed(2)}% | median ${medRet.toFixed(2)}% | avg MAE ${avgMae.toFixed(1)}% | worst MAE ${worstMae.toFixed(1)}%`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
