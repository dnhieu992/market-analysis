/**
 * Test the user's idea: shallower first entry (e.g. -8 instead of -12) + MORE DCA tranches.
 * Does "shallow + many tranches" stay robust across BOTH regimes (IS 2017-2022 AND OOS 2023-2026),
 * or does it also overfit? Each config: N equal tranches (1/N of cycle cash each), sell all at +tp.
 * FAIR fill model + 0.05% slippage. Buy & Hold: IS +286%, OOS +263% (the bar to beat in BOTH).
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-dca-tranches-oos.ts [symbol]
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
const D = (d: Date) => d.toISOString().slice(0, 10);

type Cfg = { tiers: number[]; tp: number; name: string };
type M = { retPct: number; cycles: number; maxDD: number; cashPct: number };

function run(candles: Candle[], cfg: Cfg): M {
  const alloc = 1 / cfg.tiers.length;
  let cash = CAPITAL, btc = 0, avgCost = 0, invested = 0;
  let peak = candles[0]!.high, cycleCash = cash;
  const fired = new Set<number>();
  let inPos = false, cycles = 0, daysInMkt = 0, equityPeak = CAPITAL, maxDD = 0;

  for (const c of candles) {
    if (!inPos) peak = Math.max(peak, c.high); else daysInMkt++;
    if (inPos && btc > 0) {
      const tpLevel = avgCost * (1 + cfg.tp / 100);
      if (c.high >= tpLevel) { cash += btc * tpLevel * (1 - SLIP) * (1 - FEE); btc = 0; invested = 0; avgCost = 0; inPos = false; fired.clear(); peak = c.high; cycles++; }
    }
    for (let t = 0; t < cfg.tiers.length; t++) {
      if (fired.has(t)) continue;
      const level = peak * (1 - cfg.tiers[t]! / 100);
      if (c.low <= level) {
        if (!inPos) { cycleCash = cash; inPos = true; }
        const spend = Math.min(alloc * cycleCash, cash);
        if (spend > 0) { const fill = level * (1 + SLIP); btc += (spend * (1 - FEE)) / fill; invested += spend; avgCost = invested / btc; cash -= spend; fired.add(t); }
      }
    }
    const eq = cash + btc * c.close;
    equityPeak = Math.max(equityPeak, eq);
    maxDD = Math.max(maxDD, (equityPeak - eq) / equityPeak);
  }
  const finalEquity = cash + btc * candles[candles.length - 1]!.close;
  return { retPct: (finalEquity / CAPITAL - 1) * 100, cycles, maxDD: maxDD * 100, cashPct: 100 - daysInMkt / candles.length * 100 };
}

function bh(candles: Candle[]): number {
  const qty = (CAPITAL * (1 - FEE)) / (candles[0]!.close * (1 + SLIP));
  return (qty * candles[candles.length - 1]!.close / CAPITAL - 1) * 100;
}

function tiersFrom(start: number, step: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => +(start + i * step).toFixed(1));
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const all = await fetchKlines(symbol, '1d', Date.UTC(2017, 0, 1), Date.now());
  const IS = all.filter((c) => c.openTime.getTime() < Date.UTC(2023, 0, 1));
  const OOS = all.filter((c) => c.openTime.getTime() >= Date.UTC(2023, 0, 1));
  const isBH = bh(IS), oosBH = bh(OOS);
  console.log(`${symbol}  IS ${D(IS[0]!.openTime)}..${D(IS[IS.length - 1]!.openTime)}  OOS ${D(OOS[0]!.openTime)}..${D(OOS[OOS.length - 1]!.openTime)}`);
  console.log(`FAIR + slip ${(SLIP * 100).toFixed(2)}%/side.  Buy&Hold: IS +${isBH.toFixed(0)}%  OOS +${oosBH.toFixed(0)}%\n`);

  const cfgs: Cfg[] = [
    { tiers: [12, 19, 26, 33], tp: 8, name: 'old IS-pick 4x deep start-12' },
    { tiers: tiersFrom(8, 4, 4), tp: 10, name: '4x start-8 step4' },
    { tiers: tiersFrom(8, 3, 6), tp: 10, name: '6x start-8 step3' },
    { tiers: tiersFrom(8, 2, 8), tp: 10, name: '8x start-8 step2' },
    { tiers: tiersFrom(5, 2, 6), tp: 10, name: '6x start-5 step2' },
    { tiers: tiersFrom(5, 2, 8), tp: 10, name: '8x start-5 step2' },
    { tiers: tiersFrom(5, 1.5, 10), tp: 10, name: '10x start-5 step1.5' },
    { tiers: tiersFrom(4, 1.5, 10), tp: 8, name: '10x start-4 step1.5 tp8' },
    { tiers: tiersFrom(3, 2, 10), tp: 12, name: '10x start-3 step2 tp12' },
    { tiers: [5, 9, 13, 17], tp: 10, name: 'hindsight 4x start-5' },
  ];

  const head = 'config                          tiers                              tp  ||  IS_ret  IS_DD IS_cash || OOS_ret OOS_DD OOScash OOScyc | beats B&H both?';
  console.log(head);
  for (const cfg of cfgs) {
    const is = run(IS, cfg), oos = run(OOS, cfg);
    const both = is.retPct > isBH && oos.retPct > oosBH ? 'YES' : 'no';
    const ts = cfg.tiers.map((x) => '-' + x).join('/');
    console.log(
      `${cfg.name.padEnd(30)}  ${ts.padEnd(32)}  ${String(cfg.tp).padStart(2)}  ||  ${('+' + is.retPct.toFixed(0)).padStart(5)}% ${is.maxDD.toFixed(0).padStart(4)}% ${is.cashPct.toFixed(0).padStart(5)}% || ${('+' + oos.retPct.toFixed(0)).padStart(5)}% ${oos.maxDD.toFixed(0).padStart(4)}% ${oos.cashPct.toFixed(0).padStart(5)}% ${String(oos.cycles).padStart(5)} | ${both}`,
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
