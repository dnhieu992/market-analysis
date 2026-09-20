#!/usr/bin/env node
/**
 * Sonic R DAY-TRADING backtest — BTCUSDT, small timeframes, 2024→now.
 *
 * Sonic R system = EMA34 (the "Dragon", drawn on high+low+close), EMA89 (mid trend
 * "blue river"), EMA200 (macro). Trend up = EMA34 > EMA89 > EMA200 (stacked bull).
 * The canonical Sonic R intraday setup is the DRAGON PULLBACK: in an established
 * trend, price dips back into the EMA34 band, then resumes — you enter on the reclaim.
 *
 * Day-trading constraint (hard): NO OVERNIGHT. Every position is force-closed at the
 * end of its own UTC calendar day, and no new entry opens in the last `noOpenTailMin`
 * minutes of a day. One position at a time, flat between.
 *
 * We sweep timeframe × pullback-target × SL width × R:R, both long & short, and rank
 * configs by expectancy (avg R) among those with enough trades. Fees modelled per side.
 *
 * Zero repo imports — reproducible from raw Binance klines. Usage:
 *   node sonicr-daytrade.mjs [feePctPerSide=0.05] [riskUsd=10] [startISO=2024-01-01]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const SYMBOL = 'BTCUSDT';
const BINANCE = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const CACHE_DIR = '/var/tmp/sonicr-cache';
const TF_MS = { '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5 };
const TIMEFRAMES = (process.env.TFS ? process.env.TFS.split(',') : ['5m', '15m', '30m', '1h']).map((s) => s.trim());

const FEE_PCT = Number(process.argv[2] ?? 0.05) / 100; // per side, fraction
const RISK_USD = Number(process.argv[3] ?? 10);
const START_ISO = process.argv[4] ?? '2024-01-01';
const START_MS = Date.parse(`${START_ISO}T00:00:00Z`);
const END_MS = Date.now();

// ---------- data ----------
async function fetchJson(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status === 418) { await sleep(2000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error('unreachable');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCandles(interval) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = `${CACHE_DIR}/${SYMBOL}-${interval}-${START_ISO}.json`;
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    // Reuse if the last candle is within ~2 days of now (fresh enough for research).
    if (cached.length && END_MS - cached[cached.length - 1].t < 2 * 864e5) return cached;
  }
  const out = [];
  let cur = START_MS;
  while (cur < END_MS) {
    const url = `${BINANCE}?symbol=${SYMBOL}&interval=${interval}&startTime=${cur}&endTime=${END_MS}&limit=${MAX_PER_REQ}`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ t: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] });
    cur = batch[batch.length - 1][0] + TF_MS[interval];
    if (batch.length < MAX_PER_REQ) break;
    await sleep(120);
  }
  writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

// ---------- indicators ----------
function emaArr(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i += 1) { e = values[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function atrArr(c, period = 14) {
  const out = new Array(c.length).fill(null);
  const tr = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i += 1) {
    tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
  }
  if (c.length <= period) return out;
  let a = tr.slice(1, period + 1).reduce((x, y) => x + y, 0) / period;
  out[period] = a;
  for (let i = period + 1; i < c.length; i += 1) { a = (a * (period - 1) + tr[i]) / period; out[i] = a; }
  return out;
}
function rsiArr(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i += 1) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  let ag = gain / period, al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

const utcDay = (ms) => Math.floor(ms / 864e5); // integer UTC day index

// ---------- strategy ----------
/**
 * Sonic R Dragon-pullback day trade. Params:
 *   target   'dragon' (pull back into EMA34 band) | 'river' (pull back to EMA89)
 *   slAtr    stop = structure ± slAtr×ATR
 *   rr       take-profit = rr × risk
 *   lookback bars over which the pullback touch must have happened
 *   both     also trade shorts in stacked-bear (else long-only)
 *   trendFlipExit  close if price closes past EMA89 against us
 * Enforces: no overnight (EOD force-close), no entry in last 60 min of a UTC day.
 */
function backtest(c, ind, p, interval) {
  const { e34c, e34h, e34l, e89, e200, atr, rsi } = ind;
  const barMin = TF_MS[interval] / 60000;
  const tailBars = Math.ceil(60 / barMin); // last ~60 min of the day: no new entries
  const barsPerDay = 1440 / barMin;
  const maxHold = Math.min(barsPerDay, p.maxHold ?? barsPerDay); // never span a day anyway

  const trades = [];
  let i = 210; // warm up EMA200
  while (i < c.length - 2) {
    const bull = e34c[i] > e89[i] && e89[i] > e200[i] && c[i].close > e89[i];
    const bear = e34c[i] < e89[i] && e89[i] < e200[i] && c[i].close < e89[i];
    if (!bull && !bear) { i += 1; continue; }
    if (bear && !p.both) { i += 1; continue; }

    const dir = bull ? 1 : -1;
    // pullback touch within lookback: price dipped to the target band, now reclaiming.
    let touched = false;
    for (let j = i - p.lookback + 1; j <= i; j += 1) {
      if (j < 0) continue;
      if (dir === 1) {
        const band = p.target === 'river' ? e89[j] : e34h[j];
        if (c[j].low <= band) touched = true;
      } else {
        const band = p.target === 'river' ? e89[j] : e34l[j];
        if (c[j].high >= band) touched = true;
      }
    }
    if (!touched) { i += 1; continue; }
    // reclaim confirm on bar i: bullish body closing back on the trend side of EMA34.
    const confirm = dir === 1
      ? c[i].close > c[i].open && c[i].close > e34c[i]
      : c[i].close < c[i].open && c[i].close < e34c[i];
    if (!confirm) { i += 1; continue; }
    // no entry in the day's tail (would be forced to close almost immediately)
    const secLeft = 864e5 - (c[i].t % 864e5);
    if (secLeft <= tailBars * TF_MS[interval]) { i += 1; continue; }

    // enter next bar open
    const entryIdx = i + 1;
    const entry = c[entryIdx].open;
    const structLow = Math.min(...c.slice(Math.max(0, i - p.lookback + 1), i + 1).map((x) => x.low));
    const structHigh = Math.max(...c.slice(Math.max(0, i - p.lookback + 1), i + 1).map((x) => x.high));
    const a = atr[i] ?? (entry * 0.003);
    const sl = dir === 1 ? Math.min(structLow, e34l[i]) - p.slAtr * a : Math.max(structHigh, e34h[i]) + p.slAtr * a;
    const riskUnit = Math.abs(entry - sl);
    if (!(riskUnit > 0)) { i += 1; continue; }
    const tp = dir === 1 ? entry + p.rr * riskUnit : entry - p.rr * riskUnit;
    const entryDay = utcDay(c[entryIdx].t);

    // simulate forward
    let exit = null, reason = null;
    for (let j = entryIdx; j < c.length && j <= entryIdx + maxHold; j += 1) {
      if (utcDay(c[j].t) !== entryDay) { exit = c[j - 1].close; reason = 'eod'; break; } // no overnight
      // SL checked before TP (pessimistic) within the same bar
      if (dir === 1) {
        if (c[j].low <= sl) { exit = sl; reason = 'sl'; break; }
        if (c[j].high >= tp) { exit = tp; reason = 'tp'; break; }
      } else {
        if (c[j].high >= sl) { exit = sl; reason = 'sl'; break; }
        if (c[j].low <= tp) { exit = tp; reason = 'tp'; break; }
      }
      if (p.trendFlipExit && j > entryIdx) {
        if (dir === 1 && c[j].close < e89[j]) { exit = c[j].close; reason = 'flip'; break; }
        if (dir === -1 && c[j].close > e89[j]) { exit = c[j].close; reason = 'flip'; break; }
      }
      if (j === entryIdx + maxHold) { exit = c[j].close; reason = 'time'; break; }
    }
    if (exit == null) { i += 1; continue; }

    const size = RISK_USD / riskUnit;
    const gross = size * (exit - entry) * dir;
    const fee = (size * entry + size * Math.abs(exit)) * FEE_PCT;
    const net = gross - fee;
    trades.push({ R: net / RISK_USD, net, reason, tExit: c[Math.min(entryIdx + maxHold, c.length - 1)].t });

    // move past the trade's exit bar (approx: continue after entry to avoid overlap)
    // find exit index
    let ei = entryIdx;
    while (ei < c.length && utcDay(c[ei].t) === entryDay) {
      if (dir === 1 ? (c[ei].low <= sl || c[ei].high >= tp) : (c[ei].high >= sl || c[ei].low <= tp)) break;
      ei += 1;
    }
    i = Math.max(i + 1, ei + 1);
  }
  return summarize(trades, c);
}

function summarize(trades, candles) {
  const n = trades.length;
  if (n === 0) return { trades: 0 };
  let sumR = 0, wins = 0, gw = 0, gl = 0, net = 0;
  let equity = 0, peak = 0, maxDD = 0;
  const byReason = {};
  for (const t of trades) {
    sumR += t.R; net += t.net;
    if (t.net > 0) { wins += 1; gw += t.R; } else { gl += Math.abs(t.R); }
    equity += t.R; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity);
    byReason[t.reason] = (byReason[t.reason] || 0) + 1;
  }
  const days = (candles[candles.length - 1].t - candles[0].t) / 864e5;
  return {
    trades: n,
    winRate: wins / n,
    expR: sumR / n,
    pf: gl === 0 ? Infinity : gw / gl,
    net$: net,
    maxDD_R: maxDD,
    perDay: n / days,
    tpPct: (byReason.tp || 0) / n,
    eodPct: (byReason.eod || 0) / n,
  };
}

// ---------- sweep ----------
async function main() {
  const grid = [];
  for (const target of ['dragon', 'river'])
    for (const slAtr of [0.25, 0.5, 1.0])
      for (const rr of [1, 1.5, 2, 3])
        for (const lookback of [3, 6])
          for (const both of [true, false])
            for (const trendFlipExit of [false, true])
              grid.push({ target, slAtr, rr, lookback, both, trendFlipExit });

  const results = [];
  for (const interval of TIMEFRAMES) {
    process.stderr.write(`\n[${interval}] loading…\n`);
    const c = await loadCandles(interval);
    const closes = c.map((x) => x.close), highs = c.map((x) => x.high), lows = c.map((x) => x.low);
    const ind = {
      e34c: emaArr(closes, 34), e34h: emaArr(highs, 34), e34l: emaArr(lows, 34),
      e89: emaArr(closes, 89), e200: emaArr(closes, 200), atr: atrArr(c, 14), rsi: rsiArr(closes, 14),
    };
    const span = `${new Date(c[0].t).toISOString().slice(0, 10)} → ${new Date(c[c.length - 1].t).toISOString().slice(0, 10)}`;
    process.stderr.write(`[${interval}] ${c.length} candles (${span}); running ${grid.length} configs…\n`);
    for (const p of grid) {
      const r = backtest(c, ind, p, interval);
      if (r.trades > 0) results.push({ interval, ...p, ...r, span });
    }
  }

  // Rank: enough trades, positive expectancy, decent PF.
  const MIN_TRADES = 120;
  const ranked = results
    .filter((r) => r.trades >= MIN_TRADES && r.expR > 0)
    .sort((a, b) => b.expR - a.expR);

  const fmt = (r) => `${r.interval.padEnd(4)} tgt=${r.target.padEnd(6)} sl=${r.slAtr} rr=${r.rr} lb=${r.lookback} both=${r.both ? 'Y' : 'N'} flip=${r.trendFlipExit ? 'Y' : 'N'} | n=${String(r.trades).padStart(4)} WR=${(r.winRate * 100).toFixed(1)}% expR=${r.expR.toFixed(3)} PF=${r.pf.toFixed(2)} net$=${r.net$.toFixed(0)} DD=${r.maxDD_R.toFixed(1)}R /day=${r.perDay.toFixed(2)} tp%=${(r.tpPct * 100).toFixed(0)}`;

  console.log(`\n===== SONIC R DAY-TRADE BACKTEST · ${SYMBOL} · fee ${(FEE_PCT * 100).toFixed(3)}%/side · risk $${RISK_USD} · from ${START_ISO} =====`);
  console.log(`total configs with trades: ${results.length}; passing (n≥${MIN_TRADES}, expR>0): ${ranked.length}\n`);
  console.log('----- TOP 15 overall (by expectancy R) -----');
  ranked.slice(0, 15).forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${fmt(r)}`));

  console.log('\n----- BEST per timeframe (by expectancy, n≥' + MIN_TRADES + ') -----');
  for (const tf of TIMEFRAMES) {
    const best = ranked.find((r) => r.interval === tf);
    console.log(best ? `${tf}: ${fmt(best)}` : `${tf}: (no config passed the gate)`);
  }

  console.log('\n----- BEST per timeframe by NET$ (n≥' + MIN_TRADES + ') -----');
  for (const tf of TIMEFRAMES) {
    const best = [...results].filter((r) => r.interval === tf && r.trades >= MIN_TRADES).sort((a, b) => b.net$ - a.net$)[0];
    console.log(best ? `${tf}: ${fmt(best)}` : `${tf}: (none)`);
  }

  writeFileSync('/var/tmp/sonicr-cache/results.json', JSON.stringify({ asOf: new Date().toISOString(), fee: FEE_PCT, risk: RISK_USD, start: START_ISO, top: ranked.slice(0, 30) }, null, 2));
  console.log('\n(full ranked top-30 → /var/tmp/sonicr-cache/results.json)');
}

main().catch((e) => { console.error(e.stack ?? e); process.exit(1); });
