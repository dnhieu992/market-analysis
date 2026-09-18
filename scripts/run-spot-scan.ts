/**
 * Spot Scan — "find the next ZEC" (universe screener).
 *
 * ZEC ran ~97× ($15.78 on 2024-07-05 → $1,535 ATH). Footprint at liftoff: DEEP drawdown from
 * all-time high, a long TIGHT BASE near the lows, a REGIME FLIP (reclaims the 200-day SMA),
 * VOLUME EXPANSION, and a BASE BREAKOUT while still EARLY (not parabolic).
 *
 * Universe: pulled live from CoinGecko `/coins/markets` (thousands of coins, ranked by market
 * cap), filtered to a market-cap window + min 24h volume, then the technical accumulation/
 * breakout signals are computed on Binance D1 klines. CoinGecko also supplies the fundamentals
 * the score uses (TRUE ATH drawdown, MC/FDV dilution, circulating %, 30d momentum).
 *
 * Screener, NOT an entry signal — it surfaces candidates to research (see the fundamental
 * due-diligence checklist in the "Spot Scan" strategy on /strategy).
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-spot-scan.ts [rows=25] [--min=30] [--max=2000] [--vol=2] [--pool=350]
 *   # market caps in $M. Default window: $30M–$2B, 24h vol ≥ $2M, scan up to 350 coins.
 */
import * as https from 'https';

const BINANCE = 'https://api.binance.com/api/v3/klines';
const BINANCE_INFO = 'https://api.binance.com/api/v3/exchangeInfo';
const CG = 'https://api.coingecko.com/api/v3';
const UA = 'market-analysis-spot-scan/1.0';
// CoinGecko symbols that are NOT the Binance pair we want (stablecoins / wrapped / dupes to skip).
const SKIP = new Set(['USDT','USDC','DAI','FDUSD','TUSD','USDE','PYUSD','USDS','BUSD','WBTC','WETH','WBETH','WEETH','STETH','WSTETH','XAUT','PAXG','USYC','BSC-USD','USD1','BUIDL']);

function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((res, rej) => {
    https.get(url, { headers: { accept: 'application/json', 'User-Agent': UA, ...headers } }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    }).on('error', rej);
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type C = { h: number; l: number; c: number; v: number };
async function klines(sym: string, startMs: number, endMs: number): Promise<C[]> {
  const out: C[] = []; let cur = startMs;
  while (cur < endMs) {
    const b = (await getJson(`${BINANCE}?symbol=${sym}&interval=1d&startTime=${cur}&endTime=${endMs}&limit=1000`)) as unknown[][] | null;
    if (!Array.isArray(b) || !b.length) break;
    for (const k of b) out.push({ h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string), v: +(k[7] as string) });
    if (b.length < 1000) break; cur = (b[b.length - 1]![0] as number) + 1;
  }
  return out;
}

/** Base assets that have a TRADING <BASE>USDT spot pair on Binance. */
async function binanceUsdtBases(): Promise<Set<string>> {
  const info = await getJson(BINANCE_INFO);
  const set = new Set<string>();
  const syms = (info?.symbols ?? []) as any[];
  for (const s of syms) if (s.quoteAsset === 'USDT' && s.status === 'TRADING') set.add(String(s.baseAsset).toUpperCase());
  return set;
}

type Fund = { sym: string; mcap: number; fdv: number | null; vol: number; athPct: number; mcFdv: number | null; circPct: number | null; chg30: number | null; rank: number };

async function cgUniverse(minM: number, maxM: number, minVolM: number, pool: number, binance: Set<string>): Promise<Fund[]> {
  const out: Fund[] = [];
  for (let page = 1; page <= 12 && out.length < pool; page++) {
    const rows = await getJson(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=30d`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const sym = String(r.symbol || '').toUpperCase();
      const mcap = r.market_cap ?? 0;
      const vol = r.total_volume ?? 0;
      if (!sym || SKIP.has(sym)) continue;
      if (!binance.has(sym)) continue; // Binance-listed coins only
      if (mcap < minM * 1e6 || mcap > maxM * 1e6) continue;
      if (vol < minVolM * 1e6) continue;
      out.push({
        sym, mcap, fdv: r.fully_diluted_valuation ?? null, vol,
        athPct: r.ath_change_percentage ?? 0,
        mcFdv: r.fully_diluted_valuation ? mcap / r.fully_diluted_valuation : null,
        circPct: r.max_supply ? (r.circulating_supply ?? 0) / r.max_supply : (r.total_supply ? (r.circulating_supply ?? 0) / r.total_supply : null),
        chg30: r.price_change_percentage_30d_in_currency ?? null,
        rank: r.market_cap_rank ?? 9999,
      });
      if (out.length >= pool) break;
    }
    await sleep(1500); // stay under CoinGecko's free rate limit
  }
  return out;
}

const smaAt = (a: number[], p: number, i: number) => (i + 1 < p ? NaN : a.slice(i - p + 1, i + 1).reduce((s, x) => s + x, 0) / p);
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

type Tech = { reclaimed: boolean; above200: boolean; baseRatio: number; offLow: number; newHigh60: boolean; volExp: number };
function technical(cs: C[]): Tech | null {
  if (cs.length < 220) return null;
  const close = cs.map((c) => c.c);
  const i = cs.length - 1;
  const price = close[i]!;
  const s200 = smaAt(close, 200, i);
  let below30 = false;
  for (let j = i - 30; j < i; j++) if (j >= 200 && close[j]! < smaAt(close, 200, j)) { below30 = true; break; }
  const baseWin = cs.slice(i - 150, i - 40);
  const baseRatio = baseWin.length ? Math.max(...baseWin.map((c) => c.h)) / Math.min(...baseWin.map((c) => c.l)) : Infinity;
  const low180 = Math.min(...cs.slice(i - 180, i + 1).map((c) => c.l));
  const high60 = Math.max(...cs.slice(i - 60, i).map((c) => c.h));
  const v30 = avg(cs.slice(i - 30, i + 1).map((c) => c.v));
  const v120 = avg(cs.slice(i - 120, i - 30).map((c) => c.v));
  return {
    reclaimed: price > s200 && below30,
    above200: price > s200,
    baseRatio,
    offLow: (price / low180 - 1) * 100,
    newHigh60: price >= high60,
    volExp: v120 ? v30 / v120 : NaN,
  };
}

type Row = Fund & { score: number; why: string[]; hasTech: boolean };
function score(f: Fund, t: Tech | null): Row {
  const why: string[] = [];
  let s = 0;
  // Fundamental (from CoinGecko) — deep value + low dilution
  if (f.athPct <= -60) { s += Math.min(22, 10 + (-f.athPct - 60) / 3); why.push(`ath ${f.athPct.toFixed(0)}%`); }
  if (f.mcFdv != null && f.mcFdv >= 0.5) { s += 8; why.push(`MC/FDV ${(f.mcFdv * 100).toFixed(0)}%`); }
  else if (f.mcFdv != null && f.mcFdv < 0.3) { why.push(`⚠ MC/FDV ${(f.mcFdv * 100).toFixed(0)}% (dilution)`); }
  // Technical (from Binance) — base / regime flip / volume / breakout
  if (t) {
    if (t.reclaimed) { s += 25; why.push('reclaim 200D'); }
    else if (t.above200) { s += 10; why.push('above 200D'); }
    if (t.baseRatio < 2.0) { s += 15; why.push(`base ${t.baseRatio.toFixed(2)}×`); }
    else if (t.baseRatio < 2.6) { s += 8; why.push(`base ${t.baseRatio.toFixed(2)}×`); }
    if (t.volExp >= 1.3) { s += Math.min(15, 8 + (t.volExp - 1.3) * 10); why.push(`vol ${t.volExp.toFixed(1)}×`); }
    if (t.newHigh60) { s += 8; why.push('60d high'); }
    if (t.offLow >= 15 && t.offLow <= 150) { s += 10; why.push(`+${t.offLow.toFixed(0)}% off low`); }
    else if (t.offLow > 150) { why.push(`⚠ +${t.offLow.toFixed(0)}% off low (late)`); }
  } else {
    why.push('mới list (thiếu lịch sử D1)');
  }
  return { ...f, score: s, why, hasTech: !!t };
}

async function runPooled<T>(items: T[], n: number, task: (x: T) => Promise<void>) {
  let idx = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (idx < items.length) await task(items[idx++]!); }));
}

async function main() {
  const args = process.argv.slice(2);
  const rows = Number(args.find((a) => !a.startsWith('--')) ?? 25);
  const flag = (k: string, d: number) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
  const minM = flag('min', 30), maxM = flag('max', 2000), minVolM = flag('vol', 2), pool = flag('pool', 350);

  console.log(`\nSpot Scan — "find the next ZEC" · ${new Date().toISOString().slice(0, 10)}`);
  console.log(`Universe: Binance-listed USDT pairs · market cap $${minM}M–$${maxM >= 1000 ? (maxM / 1000) + 'B' : maxM + 'M'} · 24h vol ≥ $${minVolM}M · up to ${pool} coins`);
  console.log('Signals: deep ATH drawdown + low dilution (fund) + tight base + 200D reclaim + volume + early breakout (tech)\n');

  const binance = await binanceUsdtBases();
  console.log(`Binance has ${binance.size} TRADING USDT pairs. Selecting the cap window from CoinGecko…`);
  const uni = await cgUniverse(minM, maxM, minVolM, pool, binance);
  console.log(`${uni.length} Binance coins in the cap window. Pulling D1 klines for technicals…`);

  const end = Date.now(), start = end - 400 * 864e5;
  const scored: Row[] = [];
  await runPooled(uni, 6, async (f) => {
    let t: Tech | null = null;
    try { t = technical(await klines(`${f.sym}USDT`, start, end)); } catch { /* not on Binance */ }
    scored.push(score(f, t));
  });
  scored.sort((a, b) => b.score - a.score);

  const m = (n: number) => (n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : '$' + (n / 1e6).toFixed(0) + 'M');
  console.log(`\n  rank coin      score  mcap    MC/FDV  ATH%   30d%   signals`);
  scored.slice(0, rows).forEach((r, k) => {
    console.log(
      `  ${String(k + 1).padStart(2)}.  ${r.sym.padEnd(8)}  ${String(Math.round(r.score)).padStart(3)}   ${m(r.mcap).padStart(6)}  ` +
      `${(r.mcFdv != null ? (r.mcFdv * 100).toFixed(0) + '%' : '—').padStart(5)}  ${(r.athPct.toFixed(0) + '%').padStart(5)}  ` +
      `${(r.chg30 != null ? (r.chg30 >= 0 ? '+' : '') + r.chg30.toFixed(0) + '%' : '—').padStart(5)}   ${r.why.join(', ')}`,
    );
  });
  const noHist = scored.filter((r) => !r.hasTech).length;
  console.log(`\n(${scored.length} Binance coins scored${noHist ? `; ${noHist} too newly listed for a full technical read` : ''}. Showing top ${Math.min(rows, scored.length)}.)`);
  console.log('Reminder: technical timing only — validate each with the fundamental DD checklist (team, investors, tokenomics, unlocks).\n');
}
main().catch((e) => { console.error(e); process.exit(1); });
