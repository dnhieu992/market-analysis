/**
 * Diagnostic: WHY does the original Config A (-10/15/20/25, tp+15) score so low?
 * Logs every cycle (entry avg cost -> exit price) for tp=15 vs tp=30, and measures:
 *   - time spent in CASH (sidelined) vs in market
 *   - "rebuy higher" events: re-entered a new cycle at an avg cost ABOVE the previous sell
 *     (i.e. sold, market kept running, bought back higher = death by a thousand cuts)
 *   - how much of the final move was left on the table vs buy & hold.
 *
 * Conservative close-based fills (same model as the sweep).
 */
import * as https from 'https';

const HOST = 'https://api.binance.com/api/v3/klines';
const FEE = 0.0005, CAPITAL = 1000;
type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((res, rej) => {
    https.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
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
const D = (d: Date) => d.toISOString().slice(0, 10);
const U = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });

function run(candles: Candle[], tiers: number[], tp: number, label: string) {
  let cash = CAPITAL, btc = 0, avgCost = 0, invested = 0;
  let peak = candles[0]!.close, cycleCash = cash, cycleStart = candles[0]!.openTime;
  const fired = new Set<number>();
  let inPos = false;
  let daysInMkt = 0, rebuyHigher = 0;
  let lastSellPrice = Infinity;
  const cyclesLog: string[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (!inPos) peak = Math.max(peak, c.close); else daysInMkt++;

    if (inPos && btc > 0) {
      const tpLevel = avgCost * (1 + tp / 100);
      if (c.close >= tpLevel) {
        cash += btc * c.close * (1 - FEE);
        cyclesLog.push(`  buy@${U(avgCost)} (${D(cycleStart)}) -> sell@${U(c.close)} (${D(c.openTime)})  equity now ${U(cash)}`);
        lastSellPrice = c.close;
        btc = 0; invested = 0; avgCost = 0; inPos = false; fired.clear(); peak = c.close;
      }
    }

    for (let t = 0; t < tiers.length; t++) {
      if (fired.has(t)) continue;
      const level = peak * (1 - tiers[t]! / 100);
      if (c.close <= level) {
        if (!inPos) { cycleCash = cash; inPos = true; cycleStart = c.openTime; }
        const spend = Math.min(0.25 * cycleCash, cash);
        if (spend > 0) {
          btc += (spend * (1 - FEE)) / c.close; invested += spend; avgCost = invested / btc; cash -= spend; fired.add(t);
          // first tranche of a fresh cycle: did we rebuy higher than the last sell?
          if (fired.size === 1 && c.close > lastSellPrice) rebuyHigher++;
        }
      }
    }
  }

  const last = candles[candles.length - 1]!;
  const finalEquity = cash + btc * last.close;
  console.log(`\n===== ${label}: tiers ${tiers.map((x) => '-' + x).join('/')}, TP +${tp}% =====`);
  cyclesLog.forEach((l) => console.log(l));
  console.log(`Completed cycles: ${cyclesLog.length}  |  re-bought HIGHER than prev sell: ${rebuyHigher} times`);
  console.log(`Time in market: ${(daysInMkt / candles.length * 100).toFixed(0)}%  (in cash ${(100 - daysInMkt / candles.length * 100).toFixed(0)}%)`);
  console.log(`State at end: ${inPos ? 'HOLDING' : 'in CASH'} ${inPos ? `(avg cost ${U(avgCost)}, price ${U(last.close)})` : ''}`);
  console.log(`FINAL EQUITY: ${U(finalEquity)}  (+${((finalEquity / CAPITAL - 1) * 100).toFixed(0)}%)`);
}

async function main() {
  const candles = await fetchKlines('BTCUSDT', '1d', Date.UTC(2017, 0, 1), Date.now());
  const bhQty = (CAPITAL * (1 - FEE)) / candles[0]!.close;
  const bh = bhQty * candles[candles.length - 1]!.close;
  console.log(`BTCUSDT ${candles.length} candles ${D(candles[0]!.openTime)} -> ${D(candles[candles.length - 1]!.openTime)}`);
  console.log(`Buy & Hold final: ${U(bh)} (+${((bh / CAPITAL - 1) * 100).toFixed(0)}%)`);

  run(candles, [10, 15, 20, 25], 15, 'ORIGINAL Config A');
  run(candles, [10, 15, 20, 25], 30, 'Config A but TP+30');
}
main().catch((e) => { console.error(e); process.exit(1); });
