/**
 * Backtest the user's DCA-no-stoploss strategy on D1:
 *
 *   A "campaign" per coin (one active at a time):
 *     START:  when oversold near support — RSI(14) <= rsiMax AND close within
 *             `nearLowPct`% above the rolling `lowWindow`-day low. Buy layer 1
 *             at close (equal `unit` $ per layer).
 *     ADD:    each time close drops a further `stepPct`% below the last add
 *             price, buy another equal layer. Capped at `maxLayers` (NO stop-loss).
 *     EXIT:   when a later candle's HIGH reclaims EMA`exitEma` (34 or 89),
 *             SELL the whole position at that EMA. (Mean-reversion take-profit.)
 *     If the campaign never reclaims the EMA by end-of-data, it is left OPEN and
 *             marked-to-market at the last close = a "stuck bag".
 *
 *   Equal $ per layer, fee on every buy and the final sell. Return is measured on
 *   capital actually deployed (unit × layersUsed). The headline risk metrics are:
 *   how many campaigns got STUCK (never recovered), the worst underwater drawdown,
 *   and how long capital stayed locked.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-dca-dip-d1-backtest.ts \
 *     [symbols] [interval] [days] [feePctPerSide] [rsiMaxList] [nearLowPct] [lowWindow] [stepPct] [maxLayers] [exitEma] [unit]
 *   e.g. ... "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,POLUSDT,TAOUSDT" 1d 2200 0.05 "30,35,40" 8 20 8 5 34 200
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
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
        open: parseFloat(k[1] as string), high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string), close: parseFloat(k[4] as string),
        openTime: new Date(k[0] as number),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period; out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i]! * k + prev * (1 - k); out[i] = prev; }
  return out;
}

function rsi(closes: number[], period: number): number[] {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i]! - closes[i - 1]!; if (d >= 0) gain += d; else loss -= d; }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Campaign = {
  coins: number; cost: number; layers: number; lastAdd: number; startIdx: number; minPrice: number;
};

function runDca(
  candles: Candle[],
  o: { rsiMax: number; nearLowPct: number; lowWindow: number; stepPct: number; maxLayers: number; exitEma: number; unit: number; feePerSide: number },
) {
  const closes = candles.map((c) => c.close);
  const e = ema(closes, o.exitEma);
  const r = rsi(closes, 14);
  const fee = o.feePerSide / 100;
  const warmup = Math.max(o.exitEma, o.lowWindow, 15);

  let active: Campaign | null = null;
  const closed: { retPct: number; layers: number; bars: number; ddPct: number }[] = [];
  let stuckOpen = 0, stuckLossPct = 0, stuckBars = 0, stuckCapital = 0;
  let totalPnl = 0; // on `unit` basis

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const em = e[i]!;
    if (!isFinite(em)) continue;

    if (active === null) {
      const ri = r[i]!;
      if (!isFinite(ri) || ri > o.rsiMax) continue;
      let recentLow = Infinity;
      for (let j = i - o.lowWindow; j < i; j++) recentLow = Math.min(recentLow, candles[j]!.low);
      if (!isFinite(recentLow) || recentLow <= 0) continue;
      if ((c.close - recentLow) / recentLow > o.nearLowPct / 100) continue;
      // open campaign, buy layer 1
      const coins = (o.unit * (1 - fee)) / c.close;
      active = { coins, cost: o.unit, layers: 1, lastAdd: c.close, startIdx: i, minPrice: c.close };
      continue;
    }

    active.minPrice = Math.min(active.minPrice, c.low);

    // EXIT: reclaim the exit-EMA → sell whole position at the EMA.
    if (c.high >= em) {
      const proceeds = active.coins * em * (1 - fee);
      const ret = proceeds / active.cost - 1;
      const avg = active.cost / active.coins; // approx (ignores buy fee in avg, fine for dd)
      const dd = (avg - active.minPrice) / avg * 100;
      closed.push({ retPct: ret * 100, layers: active.layers, bars: i - active.startIdx, ddPct: dd });
      totalPnl += proceeds - active.cost;
      active = null;
      continue;
    }

    // ADD: dropped a further stepPct below last add, and layers left.
    if (active.layers < o.maxLayers && c.close <= active.lastAdd * (1 - o.stepPct / 100)) {
      active.coins += (o.unit * (1 - fee)) / c.close;
      active.cost += o.unit;
      active.layers += 1;
      active.lastAdd = c.close;
    }
  }

  // End-of-data: any open campaign is a stuck bag, mark-to-market.
  if (active) {
    const last = candles[candles.length - 1]!;
    const proceeds = active.coins * last.close * (1 - fee);
    const ret = proceeds / active.cost - 1;
    const avg = active.cost / active.coins;
    stuckOpen = 1;
    stuckLossPct = ret * 100;
    stuckBars = candles.length - 1 - active.startIdx;
    stuckCapital = active.cost;
    totalPnl += proceeds - active.cost;
  }

  const wins = closed.filter((t) => t.retPct > 0).length;
  const avgRet = closed.length ? closed.reduce((s, t) => s + t.retPct, 0) / closed.length : 0;
  const avgLayers = closed.length ? closed.reduce((s, t) => s + t.layers, 0) / closed.length : 0;
  const avgBars = closed.length ? closed.reduce((s, t) => s + t.bars, 0) / closed.length : 0;
  const worstDD = closed.reduce((m, t) => Math.max(m, t.ddPct), 0);

  return {
    campaigns: closed.length + stuckOpen,
    closedTP: closed.length,
    wins,
    winRate: closed.length ? wins / closed.length : 0,
    avgRet, avgLayers, avgBars, worstDD,
    stuckOpen, stuckLossPct, stuckBars, stuckCapital,
    totalPnl,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, feeArg, rsiArg, nearArg, winArg, stepArg, layersArg, exitEmaArg, unitArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,POLUSDT,TAOUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '1d';
  const days = Number(daysArg ?? 2200);
  const feePerSide = Number(feeArg ?? 0.05);
  const rsiMaxList = (rsiArg ?? '30,35,40').split(',').map(Number);
  const nearLowPct = Number(nearArg ?? 8);
  const lowWindow = Number(winArg ?? 20);
  const stepPct = Number(stepArg ?? 8);
  const maxLayers = Number(layersArg ?? 5);
  const exitEma = Number(exitEmaArg ?? 34);
  const unit = Number(unitArg ?? 200);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  const dataBySymbol = new Map<string, Candle[]>();
  for (const symbol of symbols) {
    const c = await fetchKlines(symbol, interval, startMs, endMs);
    dataBySymbol.set(symbol, c);
    const span = c.length ? `${c[0]!.openTime.toISOString().slice(0, 10)} → ${c[c.length - 1]!.openTime.toISOString().slice(0, 10)}` : 'no data';
    console.log(`data ${symbol.padEnd(10)} ${String(c.length).padStart(5)} candles  (${span})`);
  }

  for (const rsiMax of rsiMaxList) {
    console.log(`\n=== DCA dip (NO SL) | start RSI<=${rsiMax} & near ${lowWindow}d-low<=${nearLowPct}% | add every -${stepPct}% x${maxLayers} layers ($${unit}/layer) | EXIT reclaim EMA${exitEma} | ${interval} ${days}d fee ${feePerSide}%/side ===`);
    console.log('symbol     | camp | TP | stuck | winRate | avgRet% | avgLyr | avgBars | worstDD% | stuckRet% | stuckBars | totalPnL$');
    for (const symbol of symbols) {
      const candles = dataBySymbol.get(symbol)!;
      if (!candles || candles.length === 0) { console.log(`${symbol.padEnd(10)} | no data`); continue; }
      const x = runDca(candles, { rsiMax, nearLowPct, lowWindow, stepPct, maxLayers, exitEma, unit, feePerSide });
      console.log(
        `${symbol.padEnd(10)} | ${String(x.campaigns).padStart(4)} | ${String(x.closedTP).padStart(2)} | ${String(x.stuckOpen).padStart(5)} | ${fmt(x.winRate * 100).padStart(6)}% | ${((x.avgRet >= 0 ? '+' : '') + fmt(x.avgRet)).padStart(7)} | ${fmt(x.avgLayers, 1).padStart(6)} | ${fmt(x.avgBars, 0).padStart(7)} | ${fmt(x.worstDD).padStart(8)} | ${(x.stuckOpen ? (x.stuckLossPct >= 0 ? '+' : '') + fmt(x.stuckLossPct) : '—').padStart(9)} | ${(x.stuckOpen ? String(x.stuckBars) : '—').padStart(9)} | ${((x.totalPnl >= 0 ? '+' : '') + fmt(x.totalPnl)).padStart(9)}`,
      );
    }
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
