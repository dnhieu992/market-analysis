/**
 * Out-of-sample validation for the Config A DCA dip-bounce family (BTC spot 1d).
 *
 * Method:
 *   - IN-SAMPLE  (IS) : 2017-08-17 .. 2022-12-31  -> sweep the full grid, pick the best params.
 *   - OUT-OF-SAMPLE (OOS): 2023-01-01 .. now       -> run the IS-chosen params on UNSEEN data.
 *   Fresh $1000 in each segment; FAIR fill model (intraday limit fills, no same-candle round-trip).
 *
 * We report whether the IS winners stay good OOS (the real overfitting test), with B&H benchmarks
 * for both segments, plus the hindsight-best OOS config to size the optimism gap.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-dca-oos.ts [symbol]
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
const D = (d: Date) => d.toISOString().slice(0, 10);

type Params = { start: number; step: number; tp: number };
type Metrics = { finalEquity: number; retPct: number; cycles: number; maxDD: number };

// Slippage (per side, fraction): a buy actually fills WORSE (higher) than its limit price and a
// sell fills WORSE (lower). Models spread + book depth + missing the exact wick. Applied on top of
// the maker/taker fee. Default 0.05%/side; overridable for sensitivity runs.
let SLIP = 0.0005;

// FAIR model, fresh capital over the given candle slice. Buy fill = level*(1+SLIP), sell = tp*(1-SLIP).
function runDca(candles: Candle[], p: Params): Metrics {
  const tiers = [p.start, p.start + p.step, p.start + 2 * p.step, p.start + 3 * p.step];
  let cash = CAPITAL, btc = 0, avgCost = 0, invested = 0;
  let peak = candles[0]!.high, cycleCash = cash;
  const fired = new Set<number>();
  let inPos = false, cycles = 0, equityPeak = CAPITAL, maxDD = 0;

  for (const c of candles) {
    if (!inPos) peak = Math.max(peak, c.high);
    if (inPos && btc > 0) {
      const tpLevel = avgCost * (1 + p.tp / 100);
      if (c.high >= tpLevel) {
        const fill = tpLevel * (1 - SLIP);
        cash += btc * fill * (1 - FEE); btc = 0; invested = 0; avgCost = 0; inPos = false; fired.clear(); peak = c.high; cycles++;
      }
    }
    for (let t = 0; t < tiers.length; t++) {
      if (fired.has(t)) continue;
      const level = peak * (1 - tiers[t]! / 100);
      if (c.low <= level) {
        if (!inPos) { cycleCash = cash; inPos = true; }
        const spend = Math.min(0.25 * cycleCash, cash);
        if (spend > 0) {
          const fill = level * (1 + SLIP);
          btc += (spend * (1 - FEE)) / fill; invested += spend; avgCost = invested / btc; cash -= spend; fired.add(t);
        }
      }
    }
    const eq = cash + btc * c.close;
    equityPeak = Math.max(equityPeak, eq);
    maxDD = Math.max(maxDD, (equityPeak - eq) / equityPeak);
  }
  const finalEquity = cash + btc * candles[candles.length - 1]!.close;
  return { finalEquity, retPct: (finalEquity / CAPITAL - 1) * 100, cycles, maxDD: maxDD * 100 };
}

function buyHold(candles: Candle[]): Metrics {
  const qty = (CAPITAL * (1 - FEE)) / (candles[0]!.close * (1 + SLIP)); // single entry, one slip
  let equityPeak = CAPITAL, maxDD = 0;
  for (const c of candles) { const eq = qty * c.close; equityPeak = Math.max(equityPeak, eq); maxDD = Math.max(maxDD, (equityPeak - eq) / equityPeak); }
  const finalEquity = qty * candles[candles.length - 1]!.close;
  return { finalEquity, retPct: (finalEquity / CAPITAL - 1) * 100, cycles: 0, maxDD: maxDD * 100 };
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const all = await fetchKlines(symbol, '1d', Date.UTC(2017, 0, 1), Date.now());
  const splitMs = Date.UTC(2023, 0, 1);
  const IS = all.filter((c) => c.openTime.getTime() < splitMs);
  const OOS = all.filter((c) => c.openTime.getTime() >= splitMs);
  console.log(`${symbol} 1d. IS: ${D(IS[0]!.openTime)}..${D(IS[IS.length - 1]!.openTime)} (${IS.length})  |  OOS: ${D(OOS[0]!.openTime)}..${D(OOS[OOS.length - 1]!.openTime)} (${OOS.length})`);
  console.log(`FAIR fill model, $${CAPITAL} fresh per segment, fee ${(FEE * 100).toFixed(2)}%/side, slippage ${(SLIP * 100).toFixed(2)}%/side.\n`);

  const isBH = buyHold(IS), oosBH = buyHold(OOS);
  console.log(`Buy & Hold  IS: +${isBH.retPct.toFixed(0)}% (maxDD ${isBH.maxDD.toFixed(0)}%)   OOS: +${oosBH.retPct.toFixed(0)}% (maxDD ${oosBH.maxDD.toFixed(0)}%)\n`);

  const startGrid = [5, 7, 8, 10, 12, 15], stepGrid = [3, 4, 5, 7, 10], tpGrid = [8, 10, 12, 15, 18, 20, 25, 30];
  const combos: Params[] = [];
  for (const start of startGrid) for (const step of stepGrid) for (const tp of tpGrid) combos.push({ start, step, tp });

  const isRes = new Map<string, Metrics>();
  const oosRes = new Map<string, Metrics>();
  const key = (p: Params) => `${p.start}|${p.step}|${p.tp}`;
  for (const p of combos) { isRes.set(key(p), runDca(IS, p)); oosRes.set(key(p), runDca(OOS, p)); }

  // IS robustness over tp neighbourhood.
  const robust = (p: Params): number => {
    const i = tpGrid.indexOf(p.tp);
    const ns = [tpGrid[i - 1], p.tp, tpGrid[i + 1]].filter((x): x is number => x != null);
    return ns.reduce((a, tp) => a + isRes.get(`${p.start}|${p.step}|${tp}`)!.retPct, 0) / ns.length;
  };

  const tierStr = (p: Params) => [p.start, p.start + p.step, p.start + 2 * p.step, p.start + 3 * p.step].map((x) => '-' + x).join('/');
  const header = 'tiers                     tp   IS_ret%  IS_DD%   ||  OOS_ret%  OOS_DD%  OOS_cyc   vs OOS_B&H';
  const row = (p: Params) => {
    const is = isRes.get(key(p))!, oos = oosRes.get(key(p))!;
    const edge = oos.retPct - oosBH.retPct;
    return `${tierStr(p).padEnd(20)}  ${String(p.tp).padStart(3)}  ${is.retPct.toFixed(0).padStart(7)}  ${is.maxDD.toFixed(0).padStart(5)}  ||  ${oos.retPct.toFixed(0).padStart(7)}  ${oos.maxDD.toFixed(0).padStart(6)}  ${String(oos.cycles).padStart(6)}   ${(edge >= 0 ? '+' : '') + edge.toFixed(0) + '%'}`;
  };

  console.log('=== Top 15 IN-SAMPLE (by robust IS return) — then see how they do OUT-OF-SAMPLE ===');
  console.log(header);
  const byRobust = [...combos].sort((a, b) => robust(b) - robust(a));
  byRobust.slice(0, 15).forEach((p) => console.log(row(p)));

  const pick = byRobust[0]!;
  const pickOOS = oosRes.get(key(pick))!;
  console.log(`\n>>> CHOSEN by IS robustness: tiers ${tierStr(pick)}, TP +${pick.tp}%`);
  console.log(`    IS : +${isRes.get(key(pick))!.retPct.toFixed(0)}% (maxDD ${isRes.get(key(pick))!.maxDD.toFixed(0)}%)`);
  console.log(`    OOS: +${pickOOS.retPct.toFixed(0)}% (maxDD ${pickOOS.maxDD.toFixed(0)}%, ${pickOOS.cycles} cycles)  vs OOS Buy&Hold +${oosBH.retPct.toFixed(0)}%  -> edge ${(pickOOS.retPct - oosBH.retPct >= 0 ? '+' : '') + (pickOOS.retPct - oosBH.retPct).toFixed(0)}%`);

  // Hindsight: best OOS config, to size the gap between chosen and the unknowable optimum.
  const bestOOS = [...combos].sort((a, b) => oosRes.get(key(b))!.retPct - oosRes.get(key(a))!.retPct)[0]!;
  console.log(`\n(For reference) HINDSIGHT-best OOS config: tiers ${tierStr(bestOOS)}, TP +${bestOOS.tp}% -> OOS +${oosRes.get(key(bestOOS))!.retPct.toFixed(0)}%`);

  // How many of the top-20 IS configs beat B&H out-of-sample?
  const top20 = byRobust.slice(0, 20);
  const beat = top20.filter((p) => oosRes.get(key(p))!.retPct > oosBH.retPct).length;
  console.log(`\nRobustness check: ${beat}/20 of the best IS configs also beat Buy & Hold OUT-OF-SAMPLE.`);

  // --- Slippage sensitivity (OOS) for the chosen config vs a high-frequency low-TP config ---
  const lowTp = bestOOS.tp <= 10 ? bestOOS : { ...pick, tp: 8 };
  const slips = [0, 0.0005, 0.001, 0.002, 0.005];
  console.log(`\n=== Slippage sensitivity (OUT-OF-SAMPLE return %) ===`);
  console.log(`slip/side:        ${slips.map((s) => (s * 100).toFixed(2) + '%').map((x) => x.padStart(9)).join('')}`);
  const sensRow = (p: Params, label: string) => {
    const vals = slips.map((s) => { SLIP = s; const r = runDca(OOS, p); return r.retPct; });
    SLIP = 0.0005;
    const cyc = runDca(OOS, p).cycles;
    console.log(`${label.padEnd(16)}` + vals.map((v) => ('+' + v.toFixed(0) + '%').padStart(9)).join('') + `   (${cyc} cyc)`);
  };
  sensRow(pick, `chosen tp${pick.tp}`);
  sensRow(lowTp, `lowTP tp${lowTp.tp}`);
  // B&H across slippage for reference (slippage barely matters: 1 trade)
  const bhVals = slips.map((s) => { SLIP = s; return buyHold(OOS).retPct; });
  SLIP = 0.0005;
  console.log(`${'Buy & Hold'.padEnd(16)}` + bhVals.map((v) => ('+' + v.toFixed(0) + '%').padStart(9)).join('') + `   (1 cyc)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
