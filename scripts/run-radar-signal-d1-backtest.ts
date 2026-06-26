/**
 * Backtest the Top/Small-Cap Radar signal on the DAILY timeframe.
 *
 * Reuses the EXACT live scoring logic (`computeSmallCapSignal` from @app/core) so the
 * backtest is faithful to what the radar shows. Long-only, one position at a time, flat
 * between trades, entered at the signal day's CLOSE.
 *
 * Rules (agreed with the user):
 *   - Entry: a daily candle closes with a "buy" condition. We test several entry
 *     definitions side-by-side:
 *        BREAKOUT        stage == 'Breakout'
 *        BREAK+TREND     stage ∈ {Breakout, Trending}
 *        SCORE>=65/70/75 signalScore >= N AND stage != 'Extended'
 *   - Exit (same for all): stage == 'Extended'  OR  rsi > 70  OR  close < EMA34.
 *     Exit at that day's close. The last open position is marked-to-market at the last close.
 *   - $1000 compounded, no leverage. Fee charged on BOTH sides (round-trip = 2×feePerSide).
 *   - Compared against buy & hold over the same tradable window.
 *
 * Intra-candle is irrelevant here — both entry and exit act on the daily CLOSE (same as the
 * live radar, which only updates on closed daily candles). Results exclude slippage/funding.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-radar-signal-d1-backtest.ts [symbols] [days] [capital] [feePctPerSide]
 *   e.g. ... ETHUSDT 1500 1000 0.05
 */
import * as https from 'https';
import { computeSmallCapSignal } from '@app/core';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const WARMUP = 210; // computeSmallCapSignal needs >= 210 candles

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
    const batch = (await fetchJson(url)) as unknown[][];
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

type EntryDef = { name: string; test: (s: ReturnType<typeof computeSmallCapSignal>) => boolean };

const ENTRY_DEFS: EntryDef[] = [
  { name: 'BREAKOUT',     test: (s) => !!s && s.stage === 'Breakout' },
  { name: 'BREAK+TREND',  test: (s) => !!s && (s.stage === 'Breakout' || s.stage === 'Trending') },
  { name: 'SCORE>=65',    test: (s) => !!s && s.signalScore >= 65 && s.stage !== 'Extended' },
  { name: 'SCORE>=70',    test: (s) => !!s && s.signalScore >= 70 && s.stage !== 'Extended' },
  { name: 'SCORE>=75',    test: (s) => !!s && s.signalScore >= 75 && s.stage !== 'Extended' },
];

// Exit condition — shared across all entry definitions.
function shouldExit(s: NonNullable<ReturnType<typeof computeSmallCapSignal>>): boolean {
  return s.stage === 'Extended' || s.rsi > 70 || !s.ema34Above;
}

type Trade = { entry: number; exit: number; entryTime: Date; exitTime: Date; retPct: number; barsHeld: number; open: boolean };

function runStrategy(candles: Candle[], entry: EntryDef, capital: number, feePerSide: number) {
  const fee = feePerSide / 100;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const vols = candles.map((c) => c.volume);

  // Precompute the signal at each day i (as-of close of day i), using only data up to i.
  const signals: (ReturnType<typeof computeSmallCapSignal>)[] = new Array(candles.length).fill(null);
  for (let i = WARMUP - 1; i < candles.length; i++) {
    signals[i] = computeSmallCapSignal(
      closes.slice(0, i + 1),
      highs.slice(0, i + 1),
      lows.slice(0, i + 1),
      vols.slice(0, i + 1),
    );
  }

  const trades: Trade[] = [];
  let equity = capital;
  let inPos = false;
  let entryPx = 0;
  let entryIdx = 0;

  for (let i = WARMUP - 1; i < candles.length; i++) {
    const s = signals[i];
    if (!s) continue;

    if (!inPos) {
      if (entry.test(s)) {
        inPos = true;
        entryPx = closes[i]!;
        entryIdx = i;
      }
    } else {
      if (shouldExit(s)) {
        const exitPx = closes[i]!;
        const ret = (exitPx - entryPx) / entryPx - 2 * fee;
        equity *= 1 + ret;
        trades.push({ entry: entryPx, exit: exitPx, entryTime: candles[entryIdx]!.openTime, exitTime: candles[i]!.openTime, retPct: ret * 100, barsHeld: i - entryIdx, open: false });
        inPos = false;
      }
    }
  }

  // Mark-to-market the final open position at the last close.
  if (inPos) {
    const i = candles.length - 1;
    const exitPx = closes[i]!;
    const ret = (exitPx - entryPx) / entryPx - 2 * fee;
    equity *= 1 + ret;
    trades.push({ entry: entryPx, exit: exitPx, entryTime: candles[entryIdx]!.openTime, exitTime: candles[i]!.openTime, retPct: ret * 100, barsHeld: i - entryIdx, open: true });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;
  const totalRet = ((equity - capital) / capital) * 100;
  const avgBars = trades.length ? trades.reduce((a, t) => a + t.barsHeld, 0) / trades.length : 0;
  const exposureDays = trades.reduce((a, t) => a + t.barsHeld, 0);

  return { entryName: entry.name, trades: trades.length, winRate, finalEquity: equity, totalRet, avgBars, exposureDays };
}

async function main() {
  const symbols = (process.argv[2] ?? 'ETHUSDT').split(',').map((s) => s.trim().toUpperCase());
  const days = parseInt(process.argv[3] ?? '1500', 10);
  const capital = parseFloat(process.argv[4] ?? '1000');
  const feePerSide = parseFloat(process.argv[5] ?? '0.05');

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  for (const symbol of symbols) {
    const candles = await fetchKlines(symbol, '1d', startMs, endMs);
    if (candles.length < WARMUP + 30) {
      console.log(`\n${symbol}: not enough candles (${candles.length}), need >= ${WARMUP + 30}`);
      continue;
    }

    // Buy & hold over the tradable window (from first signal day to last close).
    const bhEntry = candles[WARMUP - 1]!.close;
    const bhExit = candles[candles.length - 1]!.close;
    const bhRet = ((bhExit - bhEntry) / bhEntry) * 100;
    const tradableDays = candles.length - (WARMUP - 1);

    console.log(`\n${'='.repeat(78)}`);
    console.log(`${symbol}  ·  1d  ·  ${candles.length} candles (${candles[0]!.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]!.openTime.toISOString().slice(0, 10)})`);
    console.log(`Tradable window: ${tradableDays} days after ${WARMUP}-candle warmup  ·  fee ${feePerSide}%/side  ·  $${capital} compounded`);
    console.log(`Buy & Hold over window: ${bhRet >= 0 ? '+' : ''}${fmt(bhRet)}%   ($${fmt(capital * (1 + bhRet / 100))})`);
    console.log(`${'-'.repeat(78)}`);
    console.log(`${'Entry rule'.padEnd(14)}${'Trades'.padStart(7)}${'Win%'.padStart(8)}${'Return%'.padStart(10)}${'FinalEq$'.padStart(12)}${'AvgHold'.padStart(9)}${'Days in'.padStart(9)}`);

    for (const def of ENTRY_DEFS) {
      const r = runStrategy(candles, def, capital, feePerSide);
      console.log(
        `${r.entryName.padEnd(14)}${String(r.trades).padStart(7)}${fmt(r.winRate, 1).padStart(8)}${(r.totalRet >= 0 ? '+' : '') + fmt(r.totalRet)}`.padEnd(0) +
          `${''.padStart(Math.max(0, 10 - ((r.totalRet >= 0 ? '+' : '') + fmt(r.totalRet)).length))}` +
          `${('$' + fmt(r.finalEquity)).padStart(12)}${fmt(r.avgBars, 1).padStart(9)}${String(r.exposureDays).padStart(9)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
