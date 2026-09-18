/**
 * Spot Scan — fundamental screener for "next-ZEC" spot buys.
 *
 * Pure FUNDAMENTAL scan (no technical/price-pattern signals). It ranks Binance-listed coins in a
 * market-cap window on the quantitative fundamentals a value buyer cares about:
 *   - DEEP drawdown from all-time high (a beaten-down survivor with room to re-rate),
 *   - LOW dilution: high MC/FDV (most of the supply already circulating — little unlock overhang),
 *   - high CIRCULATING %: little future inflation.
 * These are the auto-fetchable fundamentals. The qualitative layer (team/CEO/CTO, investors,
 * tokenomics allocation, unlock schedule, traction, narrative) is manual DD — see the "Spot Scan"
 * strategy on /strategy for the checklist + sources.
 *
 * Data: Binance `exchangeInfo` (tradable USDT universe) + CoinGecko `/coins/markets` (market cap,
 * FDV, ATH, supply). No API keys, no price klines.
 *
 * Reference — ZEC passed this cleanly: at its $15.78 low it was ~−99.5% from its $3,191 ATH, with
 * a hard 21M cap, ~73% already mined (fair-launch, no VC unlock overhang) — then ran ~97×.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-spot-scan.ts [rows=25] [--min=30] [--max=2000] [--vol=2] [--pool=400]
 */
import * as https from 'https';

const BINANCE_INFO = 'https://api.binance.com/api/v3/exchangeInfo';
const CG = 'https://api.coingecko.com/api/v3';
const UA = 'market-analysis-spot-scan/1.0';
const SKIP = new Set(['USDT','USDC','DAI','FDUSD','TUSD','USDE','PYUSD','USDS','BUSD','WBTC','WETH','WBETH','WEETH','STETH','WSTETH','XAUT','PAXG','USYC','BSC-USD','USD1','BUIDL']);

function getJson(url: string): Promise<any> {
  return new Promise((res, rej) => {
    https.get(url, { headers: { accept: 'application/json', 'User-Agent': UA } }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    }).on('error', rej);
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Base assets that have a TRADING <BASE>USDT spot pair on Binance. */
async function binanceUsdtBases(): Promise<Set<string>> {
  const info = await getJson(BINANCE_INFO);
  const set = new Set<string>();
  for (const s of (info?.symbols ?? []) as any[]) if (s.quoteAsset === 'USDT' && s.status === 'TRADING') set.add(String(s.baseAsset).toUpperCase());
  return set;
}

type Row = {
  sym: string; mcap: number; vol: number; athPct: number; mcFdv: number | null; circPct: number | null;
  chg30: number | null; score: number; why: string[];
};

function scoreFund(r: Omit<Row, 'score' | 'why'>): Row {
  const why: string[] = [];
  let s = 0;
  // 1. Deep value — how far below the all-time high (max 45)
  if (r.athPct <= -50) { const pts = Math.min(45, 15 + (-r.athPct - 50) * 0.6); s += pts; why.push(`ATH ${r.athPct.toFixed(0)}%`); }
  else why.push(`ATH ${r.athPct.toFixed(0)}% (chưa sâu)`);
  // 2. Low dilution — MC/FDV (max 35)
  if (r.mcFdv != null) {
    const p = r.mcFdv * 100;
    if (r.mcFdv >= 0.8) { s += 35; why.push(`MC/FDV ${p.toFixed(0)}%`); }
    else if (r.mcFdv >= 0.6) { s += 22; why.push(`MC/FDV ${p.toFixed(0)}%`); }
    else if (r.mcFdv >= 0.4) { s += 8; why.push(`⚠ MC/FDV ${p.toFixed(0)}%`); }
    else why.push(`🚩 MC/FDV ${p.toFixed(0)}% (pha loãng nặng)`);
  } else why.push('MC/FDV —');
  // 3. Circulating supply already out (max 20)
  if (r.circPct != null) {
    if (r.circPct >= 0.85) s += 20;
    else if (r.circPct >= 0.6) s += 10;
    else why.push(`🚩 mới ${(r.circPct * 100).toFixed(0)}% cung lưu hành`);
  }
  return { ...r, score: s, why };
}

async function cgUniverse(minM: number, maxM: number, minVolM: number, pool: number, binance: Set<string>): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 1; page <= 12 && out.length < pool; page++) {
    const rows = await getJson(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=30d`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const sym = String(r.symbol || '').toUpperCase();
      const mcap = r.market_cap ?? 0;
      const vol = r.total_volume ?? 0;
      if (!sym || SKIP.has(sym) || !binance.has(sym)) continue;
      if (mcap < minM * 1e6 || mcap > maxM * 1e6) continue;
      if (vol < minVolM * 1e6) continue;
      out.push(scoreFund({
        sym, mcap, vol,
        athPct: r.ath_change_percentage ?? 0,
        mcFdv: r.fully_diluted_valuation ? mcap / r.fully_diluted_valuation : null,
        circPct: r.max_supply ? (r.circulating_supply ?? 0) / r.max_supply : (r.total_supply ? (r.circulating_supply ?? 0) / r.total_supply : null),
        chg30: r.price_change_percentage_30d_in_currency ?? null,
      }));
      if (out.length >= pool) break;
    }
    await sleep(1500); // stay under CoinGecko's free rate limit
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const rows = Number(args.find((a) => !a.startsWith('--')) ?? 25);
  const flag = (k: string, d: number) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
  const minM = flag('min', 30), maxM = flag('max', 2000), minVolM = flag('vol', 2), pool = flag('pool', 400);

  console.log(`\nSpot Scan (fundamental) — "next ZEC" · ${new Date().toISOString().slice(0, 10)}`);
  console.log(`Universe: Binance-listed USDT pairs · market cap $${minM}M–$${maxM >= 1000 ? maxM / 1000 + 'B' : maxM + 'M'} · 24h vol ≥ $${minVolM}M`);
  console.log('Score: deep drawdown from ATH + low dilution (MC/FDV) + high circulating %. (No technicals.)\n');

  const binance = await binanceUsdtBases();
  const uni = (await cgUniverse(minM, maxM, minVolM, pool, binance)).sort((a, b) => b.score - a.score);

  const m = (n: number) => (n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : '$' + (n / 1e6).toFixed(0) + 'M');
  console.log(`  #   coin      score  mcap    MC/FDV  circ%  ATH%    30d%   fundamentals`);
  uni.slice(0, rows).forEach((r, k) => {
    console.log(
      `  ${String(k + 1).padStart(2)}. ${r.sym.padEnd(8)}  ${String(Math.round(r.score)).padStart(3)}   ${m(r.mcap).padStart(6)}  ` +
      `${(r.mcFdv != null ? (r.mcFdv * 100).toFixed(0) + '%' : '—').padStart(5)}  ${(r.circPct != null ? (r.circPct * 100).toFixed(0) + '%' : '—').padStart(4)}  ` +
      `${(r.athPct.toFixed(0) + '%').padStart(5)}  ${(r.chg30 != null ? (r.chg30 >= 0 ? '+' : '') + r.chg30.toFixed(0) + '%' : '—').padStart(5)}   ${r.why.join(', ')}`,
    );
  });
  console.log(`\n(${uni.length} Binance coins in the cap window. Showing top ${Math.min(rows, uni.length)}.)`);
  console.log('Next: manual DD on the top picks — team, investors, tokenomics allocation, unlock schedule, traction, narrative.\n');
}
main().catch((e) => { console.error(e); process.exit(1); });
