/**
 * Diagnose the 2023-2026 OOS underperformance: was it "orders never FILLED" (sat in cash, missed
 * the rally) or "filled but TP never HIT" (stuck holding underwater)? FAIR model + 0.05% slippage.
 *
 * Logs per config: every completed cycle (buy avg -> sell), how many tranches fired, time in
 * cash vs in market, rebuy-higher count, and the end state.
 */
import * as https from 'https';
const HOST = 'https://api.binance.com/api/v3/klines';
const FEE = 0.0005, SLIP = 0.0005, CAPITAL = 1000;
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
const D = (d: Date) => d.toISOString().slice(0, 10);

function diag(candles: Candle[], tiersPct: number[], tp: number, label: string) {
  let cash = CAPITAL, btc = 0, avgCost = 0, invested = 0;
  let peak = candles[0]!.high, cycleCash = cash, cycleStart = candles[0]!.openTime;
  const fired = new Set<number>();
  let inPos = false, cycles = 0, daysInMkt = 0, rebuyHigher = 0, lastSell = Infinity;
  const tierFireCount = new Array(tiersPct.length).fill(0);
  const log: string[] = [];

  for (const c of candles) {
    if (!inPos) peak = Math.max(peak, c.high); else daysInMkt++;

    if (inPos && btc > 0) {
      const tpLevel = avgCost * (1 + tp / 100);
      if (c.high >= tpLevel) {
        const fill = tpLevel * (1 - SLIP);
        cash += btc * fill * (1 - FEE);
        log.push(`  ${D(cycleStart)} buy@${U(avgCost)} -> ${D(c.openTime)} sell@${U(fill)}  equity ${U(cash)}`);
        lastSell = fill; btc = 0; invested = 0; avgCost = 0; inPos = false; fired.clear(); peak = c.high; cycles++;
      }
    }
    for (let t = 0; t < tiersPct.length; t++) {
      if (fired.has(t)) continue;
      const level = peak * (1 - tiersPct[t]! / 100);
      if (c.low <= level) {
        if (!inPos) { cycleCash = cash; inPos = true; cycleStart = c.openTime; }
        const fill = level * (1 + SLIP);
        const spend = Math.min(0.25 * cycleCash, cash);
        if (spend > 0) {
          btc += (spend * (1 - FEE)) / fill; invested += spend; avgCost = invested / btc; cash -= spend; fired.add(t); tierFireCount[t]++;
          if (fired.size === 1 && fill > lastSell) rebuyHigher++;
        }
      }
    }
  }
  const last = candles[candles.length - 1]!;
  const finalEquity = cash + btc * last.close;
  console.log(`\n===== ${label}: tiers ${tiersPct.map((x) => '-' + x).join('/')}, TP +${tp}% =====`);
  log.forEach((l) => console.log(l));
  console.log(`Tranche fills per tier: ${tiersPct.map((x, i) => `-${x}%:${tierFireCount[i]}`).join('  ')}`);
  console.log(`Completed cycles (TP hit): ${cycles}   |   re-bought HIGHER than prev sell: ${rebuyHigher}`);
  console.log(`Time in market: ${(daysInMkt / candles.length * 100).toFixed(0)}%   in CASH: ${(100 - daysInMkt / candles.length * 100).toFixed(0)}%`);
  console.log(`End state: ${inPos ? `HOLDING (avg ${U(avgCost)}, price ${U(last.close)}, ${avgCost > last.close ? 'UNDERWATER' : 'in profit'})` : 'in CASH'}`);
  console.log(`FINAL: ${U(finalEquity)} (+${((finalEquity / CAPITAL - 1) * 100).toFixed(0)}%)`);
}

async function main() {
  const all = await fetchKlines('BTCUSDT', '1d', Date.UTC(2017, 0, 1), Date.now());
  const OOS = all.filter((c) => c.openTime.getTime() >= Date.UTC(2023, 0, 1));
  const bh = (CAPITAL * (1 - FEE)) / (OOS[0]!.close * (1 + SLIP)) * OOS[OOS.length - 1]!.close;
  console.log(`OOS ${D(OOS[0]!.openTime)}..${D(OOS[OOS.length - 1]!.openTime)} (${OOS.length} candles). Buy&Hold +${((bh / CAPITAL - 1) * 100).toFixed(0)}%`);

  diag(OOS, [12, 19, 26, 33], 8, 'IS-CHOSEN (failed OOS)');
  diag(OOS, [5, 9, 13, 17], 10, 'HINDSIGHT-best OOS');
}
main().catch((e) => { console.error(e); process.exit(1); });
