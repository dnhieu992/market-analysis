/**
 * Why was the optimistic backtest a fantasy? It is NOT about limit orders failing to fill at
 * the exact price (they do). It is about (a) the unknown PATH within a daily candle and
 * (b) round-tripping (buy + take-profit) inside the SAME candle.
 *
 * We run the SAME strategy under 3 fill models and compare:
 *
 *   1. OPTIMISTIC  : intraday limit fills, and a TP may fill on the SAME candle as the entry.
 *                    (Engine assumes: price dipped to your entry, THEN rallied to your TP, same day.)
 *   2. FAIR        : intraday limit fills (exact tier & TP prices, as you asked) BUT a position
 *                    opened on a candle cannot be TP-sold until a LATER candle. Your TP limit is
 *                    only repriced/known AFTER the entry fills, so it can only catch a future
 *                    candle's high, not the high that already happened this candle.
 *   3. CONSERVATIVE: everything on close (lower bound).
 *
 * The gap between OPTIMISTIC and FAIR is exactly the "same-candle round-trip" illusion.
 */
import * as https from 'https';
const HOST = 'https://api.binance.com/api/v3/klines';
const FEE = 0.0005, CAPITAL = 1000;
type Candle = { open: number; high: number; low: number; close: number; openTime: Date };
function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((res, rej) => { https.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); });
}
async function fetchKlines(symbol: string, interval: string, s: number, e: number): Promise<Candle[]> {
  const out: Candle[] = []; let cur = s;
  while (cur < e) {
    const b = (await fetchJson(`${HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${e}&limit=1000`)) as unknown[][];
    if (!Array.isArray(b) || !b.length) break;
    for (const k of b) out.push({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), openTime: new Date(k[0] as number) });
    if (b.length < 1000) break; cur = (b[b.length - 1]![0] as number) + 1;
  }
  return out;
}
const U = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });

type Mode = 'optimistic' | 'fair' | 'conservative';

function run(candles: Candle[], tiers: number[], tp: number, mode: Mode) {
  let cash = CAPITAL, btc = 0, avgCost = 0, invested = 0;
  let peak = candles[0]!.close, cycleCash = cash;
  const fired = new Set<number>();
  let inPos = false, cycles = 0, sameBarRoundTrips = 0;

  const tpHit = (price: number) => price >= avgCost * (1 + tp / 100);

  for (const c of candles) {
    if (!inPos) peak = Math.max(peak, mode === 'conservative' ? c.close : c.high);
    const wasInPosEnteringBar = inPos;

    // FAIR & CONSERVATIVE: TP for positions held coming INTO this bar, BEFORE today's entries.
    if (mode !== 'optimistic' && inPos && btc > 0) {
      const exitPx = mode === 'conservative' ? c.close : avgCost * (1 + tp / 100);
      const cond = mode === 'conservative' ? c.close >= avgCost * (1 + tp / 100) : c.high >= avgCost * (1 + tp / 100);
      if (cond) { cash += btc * exitPx * (1 - FEE); btc = 0; invested = 0; avgCost = 0; inPos = false; fired.clear(); peak = mode === 'conservative' ? c.close : c.high; cycles++; }
    }

    // Entries.
    let enteredThisBar = false;
    for (let t = 0; t < tiers.length; t++) {
      if (fired.has(t)) continue;
      const level = peak * (1 - tiers[t]! / 100);
      const hit = mode === 'conservative' ? c.close <= level : c.low <= level;
      if (hit) {
        if (!inPos) { cycleCash = cash; inPos = true; }
        const fillPx = mode === 'conservative' ? c.close : level;
        const spend = Math.min(0.25 * cycleCash, cash);
        if (spend > 0) { btc += (spend * (1 - FEE)) / fillPx; invested += spend; avgCost = invested / btc; cash -= spend; fired.add(t); enteredThisBar = true; }
      }
    }

    // OPTIMISTIC: TP allowed on the SAME bar as the entry (the fantasy).
    if (mode === 'optimistic' && inPos && btc > 0 && c.high >= avgCost * (1 + tp / 100)) {
      cash += btc * avgCost * (1 + tp / 100) * (1 - FEE);
      if (enteredThisBar && !wasInPosEnteringBar) sameBarRoundTrips++;
      btc = 0; invested = 0; avgCost = 0; inPos = false; fired.clear(); peak = c.high; cycles++;
    }
  }

  const finalEquity = cash + btc * candles[candles.length - 1]!.close;
  return { mode, finalEquity, retPct: (finalEquity / CAPITAL - 1) * 100, cycles, sameBarRoundTrips };
}

async function main() {
  const candles = await fetchKlines('BTCUSDT', '1d', Date.UTC(2017, 0, 1), Date.now());
  const bh = (CAPITAL * (1 - FEE)) / candles[0]!.close * candles[candles.length - 1]!.close;
  console.log(`BTCUSDT ${candles.length} candles. Buy & Hold = ${U(bh)} (+${((bh / CAPITAL - 1) * 100).toFixed(0)}%)\n`);

  const tests: { tiers: number[]; tp: number; label: string }[] = [
    { tiers: [10, 15, 20, 25], tp: 15, label: 'Config A  (-10/15/20/25, tp+15)' },
    { tiers: [10, 14, 18, 22], tp: 8, label: 'Tight+lowTP (-10/14/18/22, tp+8) <- the +30000% "winner"' },
    { tiers: [8, 13, 18, 23], tp: 30, label: 'Tuned (-8/13/18/23, tp+30)' },
  ];

  for (const t of tests) {
    console.log(`### ${t.label}`);
    for (const mode of ['optimistic', 'fair', 'conservative'] as Mode[]) {
      const r = run(candles, t.tiers, t.tp, mode);
      console.log(`  ${mode.padEnd(13)} final ${U(r.finalEquity).padStart(11)}  ret ${(r.retPct >= 0 ? '+' : '') + r.retPct.toFixed(0) + '%'}`.padEnd(48) + `cycles=${r.cycles}` + (mode === 'optimistic' ? `  same-candle round-trips=${r.sameBarRoundTrips}` : ''));
    }
    console.log('');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
