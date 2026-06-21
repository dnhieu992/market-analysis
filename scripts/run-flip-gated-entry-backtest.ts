/**
 * Backtest a NEW base-entry gate on top of the user's swing flip flow.
 *
 * Base flow (unchanged): UTBot trend stop-and-reverse on CANDLE CLOSE.
 *   trend = close > stop ? bull : bear. On a confirmed flip, close everything and reverse.
 *   "đường trend" = the UTBot trailing-stop line. At the flip candle the new stop is placed
 *   exactly nLoss = keyValue×ATR away from the close, so the entry's distance from the line
 *   at a flip is ALWAYS keyValue×ATR/close.
 *
 * CURRENT (live page) base entry:  on every flip, enter the base immediately at the close.
 *
 * NEW base entry (this script):
 *   - On a flip, if dist% = |close-line|/line  <  entryGatePct (default 3%) → enter base now.
 *   - Else (dist ≥ gate) → DO NOT enter immediately. Mark the leg "pending" and wait: while
 *     still in the same trend, the FIRST candle whose close comes within the pullback band
 *     (default 1%) of the line opens the base there (a delayed pullback entry). If the trend
 *     flips again before that happens, the leg is abandoned (we stayed flat for that leg).
 *
 * Pullback scale-in add-on (UNCHANGED): once a base exists, while aligned with the trend, a
 * close within `bandPct` (1%) of the line opens ONE MORE leg in the trend direction; re-arm
 * after price moves > band away; max `maxAdds` (3) per trend leg. Mirrors production where the
 * add-on only runs when keyValue === 4.
 *
 * Sizing: FLAT $notional per leg (default $100), no compounding. Net PnL in $.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-flip-gated-entry-backtest.ts \
 *     [days] [feePctPerSide] [entryGatePct] [bandPct] [maxAdds] [notional] [symbol] [interval] [keyValue]
 *   - With no symbol/interval/keyValue it runs the 4 live SWING_PAIRS.
 *   e.g. ... 365 0.05 3 1 3 100
 *   e.g. single config: ... 365 0.05 3 1 3 100 BNBUSDT 4h 4
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;

// Mirrors apps/worker/src/modules/swing-trading/swing-pairs.ts
const LIVE_PAIRS: { symbol: string; interval: string; keyValue: number }[] = [
  { symbol: 'ETHUSDT', interval: '4h', keyValue: 2 },
  { symbol: 'BTCUSDT', interval: '1d', keyValue: 2 },
  { symbol: 'BNBUSDT', interval: '4h', keyValue: 4 },
  { symbol: 'SOLUSDT', interval: '1d', keyValue: 2 },
];

// Production gates the pullback add-on to clean-trend configs only (kv === 4).
const addonEnabledFor = (kv: number): boolean => kv === 4;

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

function wilderAtr(c: Candle[], period: number): number[] {
  const n = c.length;
  const tr = c.map((x, i) =>
    i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close)),
  );
  const atr = new Array(n).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  return atr;
}

function utBotStops(c: Candle[], period: number, keyValue: number): number[] {
  const atr = wilderAtr(c, period);
  const stop = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const nLoss = keyValue * atr[i]!;
    const close = c[i]!.close;
    const prevC = c[i - 1]!.close;
    const prev = stop[i - 1]!;
    if (close > prev && prevC > prev) stop[i] = Math.max(prev, close - nLoss);
    else if (close < prev && prevC < prev) stop[i] = Math.min(prev, close + nLoss);
    else if (close > prev) stop[i] = close - nLoss;
    else stop[i] = close + nLoss;
  }
  return stop;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Leg = { dir: 'long' | 'short'; entry: number; kind: 'base' | 'add' };

type Result = {
  legs: number;
  adds: number;
  wins: number;
  winRate: number;
  netPnl: number;
  maxDD: number;
  // entry-gate diagnostics (NEW mode only)
  flips: number;
  immediate: number;
  pended: number;
  delayedFilled: number;
  abandoned: number;
};

/**
 * @param useGate   false = CURRENT live (enter base immediately on every flip).
 *                  true  = NEW (gate immediate entry to dist<gate, else wait for pullback).
 */
function runFlip(
  candles: Candle[],
  keyValue: number,
  feePerSide: number,
  entryGatePct: number,
  bandPct: number,
  fillBandPct: number,
  maxAdds: number,
  notional: number,
  useGate: boolean,
  useAddon: boolean,
): Result {
  const stop = utBotStops(candles, ATR_PERIOD, keyValue);
  const fee = feePerSide / 100;
  const band = bandPct / 100; // scale-in add-on band (unchanged, 1%)
  const fillBand = fillBandPct / 100; // delayed base-entry band (pullback fill after a far flip)
  const gate = entryGatePct / 100;

  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < ATR_PERIOD || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };

  const closeLeg = (leg: Leg, exit: number): number => {
    const gross = leg.dir === 'long' ? (exit - leg.entry) / leg.entry : (leg.entry - exit) / leg.entry;
    return notional * gross - notional * fee * 2;
  };

  const pnls: number[] = [];
  let openLegs: Leg[] = [];
  let prevTrend: 'bull' | 'bear' | null = null;
  let addsThisTrend = 0;
  let addsTotal = 0;
  let armed = false;
  // pending base entry (NEW gate): we flipped but distance was too far to enter immediately
  let pending = false;
  let pendingDir: 'long' | 'short' = 'long';

  let flips = 0, immediate = 0, pended = 0, delayedFilled = 0, abandoned = 0;

  // Decide the base entry on a (re)entry event at candle close.
  const enterOrPend = (dir: 'long' | 'short', entry: number, dist: number) => {
    addsThisTrend = 0;
    armed = false;
    if (!useGate || dist < gate) {
      openLegs = [{ dir, entry, kind: 'base' }];
      pending = false;
      immediate++;
    } else {
      openLegs = [];
      pending = true;
      pendingDir = dir;
      pended++;
    }
  };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const close = candles[i]!.close;
    const line = stop[i]!;
    const dist = line !== 0 ? Math.abs(close - line) / line : Infinity;

    // First entry
    if (prevTrend === null) {
      flips++;
      enterOrPend(t === 'bull' ? 'long' : 'short', close, dist);
      prevTrend = t;
      continue;
    }

    // Confirmed flip → close ALL legs, then re-evaluate the base entry (gated or immediate)
    if (t !== prevTrend) {
      for (const leg of openLegs) pnls.push(closeLeg(leg, close));
      if (pending) abandoned++; // we never filled the previous pending base before this flip
      openLegs = [];
      flips++;
      enterOrPend(t === 'bull' ? 'long' : 'short', close, dist);
      prevTrend = t;
      continue;
    }

    // Same trend, base still pending → fill it on the first pullback inside the fill band
    if (pending) {
      if (dist <= fillBand) {
        openLegs = [{ dir: pendingDir, entry: close, kind: 'base' }];
        pending = false;
        armed = false;
        addsThisTrend = 0;
        delayedFilled++;
      }
      continue; // no scale-ins until a base exists
    }

    // Same trend with a base → pullback scale-in add-on
    if (useAddon && openLegs.length > 0) {
      if (dist > band) {
        armed = true;
      } else if (armed && addsThisTrend < maxAdds) {
        const dir = prevTrend === 'bull' ? 'long' : 'short';
        openLegs.push({ dir, entry: close, kind: 'add' });
        addsThisTrend++;
        addsTotal++;
        armed = false;
      }
    }
  }

  // Mark-to-market any still-open legs at the last close (closing-side fee only)
  if (openLegs.length > 0) {
    const last = candles[candles.length - 1]!.close;
    for (const leg of openLegs) {
      const gross = leg.dir === 'long' ? (last - leg.entry) / leg.entry : (leg.entry - last) / leg.entry;
      pnls.push(notional * gross - notional * fee);
    }
  }

  const wins = pnls.filter((p) => p > 0).length;
  const netPnl = pnls.reduce((a, b) => a + b, 0);

  let cum = 0, peak = 0, maxDD = 0;
  for (const p of pnls) {
    cum += p;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    legs: pnls.length,
    adds: addsTotal,
    wins,
    winRate: pnls.length ? wins / pnls.length : 0,
    netPnl,
    maxDD,
    flips,
    immediate,
    pended,
    delayedFilled,
    abandoned,
  };
}

async function runConfig(
  symbol: string,
  interval: string,
  keyValue: number,
  days: number,
  feePerSide: number,
  entryGatePct: number,
  bandPct: number,
  fillBandPct: number,
  maxAdds: number,
  notional: number,
) {
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  const addon = addonEnabledFor(keyValue);
  const cur = runFlip(candles, keyValue, feePerSide, entryGatePct, bandPct, fillBandPct, maxAdds, notional, false, addon);
  const neo = runFlip(candles, keyValue, feePerSide, entryGatePct, bandPct, fillBandPct, maxAdds, notional, true, addon);
  const delta = neo.netPnl - cur.netPnl;
  const range = `${candles[0]?.openTime.toISOString().slice(0, 10)}→${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`;

  console.log(
    `${(symbol + ' ' + interval).padEnd(13)} kv=${keyValue} addon=${addon ? 'on ' : 'off'} | ` +
      `${candles.length} candles ${range}`,
  );
  console.log(
    `   CURRENT (enter every flip) : legs ${String(cur.legs).padStart(3)}  win ${fmt(cur.winRate * 100).padStart(5)}%  ` +
      `net ${('$' + fmt(cur.netPnl)).padStart(9)}  maxDD ${('$' + fmt(cur.maxDD)).padStart(8)}`,
  );
  console.log(
    `   NEW (gate ${entryGatePct}% + fill≤${fillBandPct}%) : legs ${String(neo.legs).padStart(3)}  win ${fmt(neo.winRate * 100).padStart(5)}%  ` +
      `net ${('$' + fmt(neo.netPnl)).padStart(9)}  maxDD ${('$' + fmt(neo.maxDD)).padStart(8)}   Δ ${(delta >= 0 ? '+' : '') + fmt(delta)}`,
  );
  console.log(
    `   entries: ${neo.flips} flips → ${neo.immediate} immediate(<${entryGatePct}%), ${neo.pended} far(≥${entryGatePct}%) ` +
      `→ ${neo.delayedFilled} filled (pullback ≤${fillBandPct}%) / ${neo.abandoned} abandoned\n`,
  );
}

async function main() {
  const [, , daysArg, feeArg, gateArg, fillBandArg, bandArg, maxAddArg, notionalArg, symArg, intArg, kvArg] = process.argv;
  const days = Number(daysArg ?? 365);
  const feePerSide = Number(feeArg ?? 0.05);
  const entryGatePct = Number(gateArg ?? 3);
  const fillBandPct = Number(fillBandArg ?? 1); // delayed base-entry pullback band
  const bandPct = Number(bandArg ?? 1); // scale-in add-on band (unchanged)
  const maxAdds = Number(maxAddArg ?? 3);
  const notional = Number(notionalArg ?? 100);

  console.log(
    `\n=== SWING FLIP: base-entry gate ${entryGatePct}% | delayed-fill ≤${fillBandPct}% | ATR(${ATR_PERIOD}) | ` +
      `$${notional}/leg flat | fee ${feePerSide}%/side | scale-in band ${bandPct}% maxAdds ${maxAdds} | ${days}d ===\n`,
  );

  const configs =
    symArg && intArg
      ? [{ symbol: symArg, interval: intArg, keyValue: Number(kvArg ?? 2) }]
      : LIVE_PAIRS;

  for (const c of configs) {
    await runConfig(c.symbol, c.interval, c.keyValue, days, feePerSide, entryGatePct, bandPct, fillBandPct, maxAdds, notional);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
