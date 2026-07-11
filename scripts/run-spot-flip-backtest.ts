/**
 * Backtest the /spot-flip strategy (dip-buy mean reversion), NOT the UTBot flow.
 *
 * Encodes the tool's exact logic on DAILY candles:
 *   - At the close of day t (analogous to the 00:15 UTC snapshot), compute over
 *     the last 30 daily candles [t-29..t]:
 *       high30d, low30d, pullbackPct = (high30d - close)/high30d*100
 *     and ATR% = avg daily range (high-low)/close*100 over the last 14 [t-13..t].
 *   - Dip depth = pullbackPct / ATR%.  The tool's "canh mua nhịp hồi" stance
 *     fires when dip depth ≥ 1 (price has pulled ≥ 1× its daily range off the
 *     30d high). Entry = long at close[t] when flat and dipDepth ≥ threshold.
 *   - TP = entry × (1 + tpMult·ATR%),  SL = entry × (1 − slMult·ATR%)
 *     (tool defaults tpMult=0.8, slMult=0.6). From day t+1 on, first touch wins;
 *     if a day trades through BOTH TP and SL, we assume SL first (conservative).
 *   - Optional forced close at day close after `maxHold` days.
 *   - One position at a time, $capital fully compounded, fee 0.05%/side.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-spot-flip-backtest.ts <symbol> <days> <capital> <feePerSide> \
 *     <tpMult> <slMult> <maxHold> <thresholdList>
 *   e.g.
 *   ... scripts/run-spot-flip-backtest.ts BTCUSDT 730 1000 0.05 0.8 0.6 30 "0.5,1,1.5,2"
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

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const RANGE_WIN = 30;
const ATR_WIN = 14;

type Trade = { entry: number; exit: number; netPct: number; holdDays: number; reason: 'TP' | 'SL' | 'MAXHOLD' };

function runSpotFlip(
  c: Candle[],
  threshold: number,
  capital: number,
  feePerSide: number,
  tpMult: number,
  slMult: number,
  maxHold: number,
) {
  const fee = feePerSide / 100;
  const trades: Trade[] = [];
  let equity = capital;
  let peak = capital;
  let maxDD = 0;

  let t = RANGE_WIN - 1;
  while (t < c.length - 1) {
    // Metrics over the last 30 / 14 completed daily candles, inclusive of t.
    const win30 = c.slice(t - RANGE_WIN + 1, t + 1);
    const win14 = c.slice(t - ATR_WIN + 1, t + 1);
    const high30d = Math.max(...win30.map((x) => x.high));
    const close = c[t]!.close;
    const pullbackPct = high30d > 0 ? ((high30d - close) / high30d) * 100 : 0;
    const atrPct =
      win14.reduce((s, x) => s + (x.close > 0 ? ((x.high - x.low) / x.close) * 100 : 0), 0) / win14.length;
    const dipDepth = atrPct > 0 ? pullbackPct / atrPct : 0;

    if (pullbackPct <= 0 || dipDepth < threshold || atrPct <= 0) {
      t += 1;
      continue;
    }

    // Enter long at close[t]. TP/SL from ATR% at entry.
    const entry = close;
    const tp = entry * (1 + (tpMult * atrPct) / 100);
    const sl = entry * (1 - (slMult * atrPct) / 100);

    let exitIdx = -1;
    let exitPrice = entry;
    let reason: Trade['reason'] = 'MAXHOLD';
    for (let u = t + 1; u < c.length; u++) {
      const day = c[u]!;
      const hitSL = day.low <= sl;
      const hitTP = day.high >= tp;
      if (hitSL) {
        // Conservative: if both touched same day, SL takes priority.
        exitIdx = u;
        exitPrice = sl;
        reason = 'SL';
        break;
      }
      if (hitTP) {
        exitIdx = u;
        exitPrice = tp;
        reason = 'TP';
        break;
      }
      if (u - t >= maxHold) {
        exitIdx = u;
        exitPrice = day.close;
        reason = 'MAXHOLD';
        break;
      }
    }
    if (exitIdx === -1) break; // open at series end — leave it out

    const netPct = (exitPrice / entry - 1) * 100 - 2 * feePerSide;
    equity *= 1 + netPct / 100;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
    trades.push({ entry, exit: exitPrice, netPct, holdDays: exitIdx - t, reason });

    t = exitIdx + 1; // resume entries after this trade closes
  }

  const wins = trades.filter((x) => x.netPct > 0).length;
  const tpN = trades.filter((x) => x.reason === 'TP').length;
  const slN = trades.filter((x) => x.reason === 'SL').length;
  const mhN = trades.filter((x) => x.reason === 'MAXHOLD').length;
  const avgHold = trades.length ? trades.reduce((s, x) => s + x.holdDays, 0) / trades.length : 0;

  return {
    trades: trades.length,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    equity,
    retPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    tpN,
    slN,
    mhN,
    avgHold,
  };
}

async function main() {
  const [
    symbol = 'BTCUSDT',
    daysStr = '730',
    capitalStr = '1000',
    feeStr = '0.05',
    tpStr = '0.8',
    slStr = '0.6',
    maxHoldStr = '30',
    thresholdListStr = '0.5,1,1.5,2',
  ] = process.argv.slice(2);

  const days = parseInt(daysStr, 10);
  const capital = parseFloat(capitalStr);
  const feePerSide = parseFloat(feeStr);
  const tpMult = parseFloat(tpStr);
  const slMult = parseFloat(slStr);
  const maxHold = parseInt(maxHoldStr, 10);
  const thresholds = thresholdListStr.split(',').map((x) => parseFloat(x.trim()));

  const endMs = Date.now();
  const startMs = endMs - (days + RANGE_WIN + 5) * 86_400_000; // pad for warmup
  const candles = await fetchKlines(symbol, '1d', startMs, endMs);

  if (candles.length < RANGE_WIN + 10) {
    console.error(`Not enough candles for ${symbol}: ${candles.length}`);
    process.exit(1);
  }

  // Buy & hold over the traded window (from first eligible day to last close).
  const first = candles[RANGE_WIN - 1]!.close;
  const last = candles[candles.length - 1]!.close;
  const bhRet = (last / first - 1) * 100;

  console.log(`\n=== Spot-Flip dip-buy backtest — ${symbol} 1d ===`);
  console.log(
    `window: ${candles[0]!.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]!.openTime
      .toISOString()
      .slice(0, 10)} (${candles.length} daily candles)`,
  );
  console.log(
    `params: capital $${capital}, fee ${feePerSide}%/side, TP ${tpMult}×ATR, SL ${slMult}×ATR, maxHold ${maxHold}d`,
  );
  console.log(`Buy & hold return over window: ${bhRet >= 0 ? '+' : ''}${fmt(bhRet)}%\n`);

  console.log(
    'thresh | trades | win% | TP/SL/MH | avgHold | net equity | return% | maxDD%',
  );
  console.log('-------|--------|------|----------|---------|------------|---------|-------');
  for (const th of thresholds) {
    const r = runSpotFlip(candles, th, capital, feePerSide, tpMult, slMult, maxHold);
    console.log(
      `${fmt(th, 1).padStart(6)} | ${String(r.trades).padStart(6)} | ${fmt(r.winRate, 0).padStart(4)} | ` +
        `${`${r.tpN}/${r.slN}/${r.mhN}`.padStart(8)} | ${fmt(r.avgHold, 1).padStart(6)}d | ` +
        `$${fmt(r.equity).padStart(9)} | ${(r.retPct >= 0 ? '+' : '') + fmt(r.retPct)}% | ${fmt(r.maxDD)}%`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
