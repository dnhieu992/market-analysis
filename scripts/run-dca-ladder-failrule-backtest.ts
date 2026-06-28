/**
 * DCA Ladder + CYCLE-FAILURE rule. Goal: detect when a cycle is "dead" so the ladder can
 * park the underwater bag to a HOLD bucket and immediately start a fresh cycle (to catch the
 * next bounce) instead of staying trapped forever.
 *
 * Capital model (per user): the loss is NOT subtracted from the ladder — a failed bag is moved
 * to a separate long-term HOLD bucket. The ladder always runs on budget = startCapital + realized
 * WINS only. Parked bags are tracked separately and marked-to-market for reporting.
 *
 * Failure rules (pick one via argv):
 *   time:<D>   cycle has been IN_POSITION >= D days without hitting TP.
 *   dd:<X>     price (daily low) falls X% below the blended avgCost.
 *   tier:<Y>   ALL tiers are filled AND price (daily low) falls Y% below the lowest tier price.
 *   none       no failure rule (baseline = current live behaviour, traps forever).
 *
 * On failure: park position (size, capitalDeployed, parkClose) to HOLD, start a NEW cycle with
 * peak = current close, budget = startCapital + realized wins.
 *
 * Usage:
 *   ts-node ... scripts/run-dca-ladder-failrule-backtest.ts <days> <rule> \
 *      [firstTierPct numTiers stepPct tpPct startCapital feePct]
 *   default params = LIVE config: 5 10 1.5 10 1000 0.05
 *   e.g.  ... 3200 tier:5
 *         ... 3200 dd:25
 *         ... 3200 time:120
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const SYMBOL = 'BTCUSDT';
const SEED_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

type Candle = { high: number; low: number; close: number; openTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchKlines(startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `${BINANCE_HOST}?symbol=${SYMBOL}&interval=1d&startTime=${cursor}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ high: parseFloat(k[2] as string), low: parseFloat(k[3] as string), close: parseFloat(k[4] as string), openTime: new Date(k[0] as number) });
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

function fmt(n: number, d = 2): string { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }

type Params = { firstTierPct: number; numTiers: number; stepPct: number; tpPct: number; startCapital: number; feePct: number };
type Rule = { kind: 'none' | 'time' | 'dd' | 'tier'; thr: number };

type Parked = { entryTime: Date; parkTime: Date; avgCost: number; size: number; capitalDeployed: number; parkClose: number; recovered: boolean; parkDaysOpen: number; daysToRecover: number | null };

function run(candles: Candle[], seedPeak: number, p: Params, rule: Rule) {
  const feeMul = 1 - p.feePct / 100;
  const pcts = Array.from({ length: p.numTiers }, (_, i) => p.firstTierPct + i * p.stepPct);
  const lowestPct = pcts[pcts.length - 1]!;

  let realizedWins = 0;
  let winCycles = 0;
  const parked: Parked[] = [];
  const winDurations: number[] = [];

  // cycle state
  let peak = seedPeak;
  let status: 'FLAT' | 'IN_POSITION' = 'FLAT';
  let filled: boolean[] = new Array(p.numTiers).fill(false);
  let size = 0, capital = 0, avgCost = 0;
  let tp: number | null = null;
  let entryTime: Date | null = null;

  // FIXED notional per cycle (no compounding) so failure-rules are compared apples-to-apples and
  // parked capital can't balloon into a fantasy. Wins are summed as plain dollars for reference.
  const budget = () => p.startCapital;
  const reset = (newPeak: number) => {
    peak = newPeak; status = 'FLAT'; filled = new Array(p.numTiers).fill(false);
    size = 0; capital = 0; avgCost = 0; tp = null; entryTime = null;
  };

  for (const c of candles) {
    const statusOpen = status, tpOpen = tp;

    if (status === 'FLAT') peak = Math.max(peak, c.high);
    const tierPrice = pcts.map((pct) => peak * (1 - pct / 100));
    const usd = budget() / p.numTiers;

    // fills
    for (let i = 0; i < p.numTiers; i++) {
      if (!filled[i] && c.low <= tierPrice[i]!) {
        filled[i] = true; size += (usd / tierPrice[i]!) * feeMul; capital += usd; avgCost = capital / size;
        if (status === 'FLAT') { status = 'IN_POSITION'; entryTime = c.openTime; }
        tp = avgCost * (1 + p.tpPct / 100);
      }
    }

    // TP (win) takes priority
    if (statusOpen === 'IN_POSITION' && tpOpen != null && c.high >= tpOpen) {
      realizedWins += size * tpOpen * feeMul - capital;
      winCycles++;
      winDurations.push(Math.round((c.openTime.getTime() - entryTime!.getTime()) / DAY));
      reset(tpOpen);
      continue;
    }

    // failure check (only if still holding and didn't TP this candle)
    if (status === 'IN_POSITION' && rule.kind !== 'none' && avgCost > 0 && entryTime) {
      const daysOpen = (c.openTime.getTime() - entryTime.getTime()) / DAY;
      const allFilled = filled.every(Boolean);
      const lowestTier = peak * (1 - lowestPct / 100);
      let failed = false;
      if (rule.kind === 'time') failed = daysOpen >= rule.thr;
      else if (rule.kind === 'dd') failed = c.low <= avgCost * (1 - rule.thr / 100);
      else if (rule.kind === 'tier') failed = allFilled && c.low <= lowestTier * (1 - rule.thr / 100);

      if (failed) {
        parked.push({ entryTime: entryTime!, parkTime: c.openTime, avgCost, size, capitalDeployed: capital, parkClose: c.close, recovered: false, parkDaysOpen: Math.round(daysOpen), daysToRecover: null });
        reset(c.close);
      }
    }
  }

  // mark final open cycle as a "still open" pseudo-park for reporting
  const last = candles[candles.length - 1]!;
  let openBag: null | { avgCost: number; capitalDeployed: number; mark: number; uwPct: number; daysOpen: number } = null;
  if (status === 'IN_POSITION') {
    openBag = { avgCost, capitalDeployed: capital, mark: last.close, uwPct: ((avgCost - last.close) / avgCost) * 100, daysOpen: Math.round((last.openTime.getTime() - entryTime!.getTime()) / DAY) };
  }

  // did each parked bag later recover to its TP (avgCost*1.1)? how long did the hold bucket take?
  for (const pk of parked) {
    const target = pk.avgCost * (1 + p.tpPct / 100);
    const hit = candles.find((c) => c.openTime > pk.parkTime && c.high >= target);
    pk.recovered = !!hit;
    pk.daysToRecover = hit ? Math.round((hit.openTime.getTime() - pk.parkTime.getTime()) / DAY) : null;
  }

  // HOLD bucket: parked bags marked-to-market at last close
  const parkedCapital = parked.reduce((a, b) => a + b.capitalDeployed, 0);
  const parkedMtm = parked.reduce((a, b) => a + b.size * last.close * feeMul, 0);

  const avgWinDur = winDurations.length ? winDurations.reduce((a, b) => a + b, 0) / winDurations.length : 0;
  const maxWinDur = winDurations.length ? Math.max(...winDurations) : 0;
  const recovered = parked.filter((p) => p.recovered).length;
  const avgParkDays = parked.length ? parked.reduce((a, b) => a + b.parkDaysOpen, 0) / parked.length : 0;
  const recDays = parked.filter((p) => p.daysToRecover != null).map((p) => p.daysToRecover!).sort((a, b) => a - b);
  const medRecover = recDays.length ? recDays[Math.floor(recDays.length / 2)]! : null;

  return {
    winCycles, realizedWins,
    parked: parked.length, parkedCapital, parkedMtm, parkedList: parked, recovered,
    avgWinDur, maxWinDur, avgParkDays, medRecover, openBag,
  };
}

async function main() {
  const a = process.argv.slice(2);
  const days = Number(a[0] ?? 3200);
  const ruleArg = (a[1] ?? 'none');
  const [rk, rt] = ruleArg.split(':');
  const rule: Rule = { kind: (rk as Rule['kind']) ?? 'none', thr: Number(rt ?? 0) };
  const p: Params = {
    firstTierPct: Number(a[2] ?? 5), numTiers: Number(a[3] ?? 10), stepPct: Number(a[4] ?? 1.5),
    tpPct: Number(a[5] ?? 10), startCapital: Number(a[6] ?? 1000), feePct: Number(a[7] ?? 0.05),
  };

  const endMs = Date.now();
  const startMs = endMs - days * DAY;
  const all = await fetchKlines(startMs - SEED_DAYS * DAY, endMs);
  const seedC = all.filter((c) => c.openTime.getTime() < startMs);
  const candles = all.filter((c) => c.openTime.getTime() >= startMs);
  const seedPeak = Math.max(...(seedC.length ? seedC : candles.slice(0, SEED_DAYS)).map((c) => c.high));

  const bh = (candles[candles.length - 1]!.close / candles[0]!.close) * p.startCapital;

  // If a specific rule is given, run detail. Otherwise sweep a standard grid.
  const tiers = Array.from({ length: p.numTiers }, (_, i) => p.firstTierPct + i * p.stepPct);
  console.log(`\n${SYMBOL} 1d ${days}d  ${candles[0]!.openTime.toISOString().slice(0,10)}→${candles[candles.length-1]!.openTime.toISOString().slice(0,10)}  | tiers ${tiers[0]}…${tiers[tiers.length-1]}% (${p.numTiers}) | TP+${p.tpPct}% | B&H $${fmt(bh)} (${bh/p.startCapital-1>=0?'+':''}${fmt((bh/p.startCapital-1)*100)}%)`);

  console.log(`(fixed notional $${p.startCapital}/cycle, wins summed as cash; parked bags go to a separate HOLD bucket)`);
  if (rule.kind !== 'none') {
    const r = run(candles, seedPeak, p, rule);
    console.log(`\n=== RULE ${ruleArg} ===`);
    console.log(`Win cycles      : ${r.winCycles}  (avg ${fmt(r.avgWinDur,0)}d, max ${r.maxWinDur}d to TP) -> realized $${fmt(r.realizedWins)}`);
    console.log(`Parked to HOLD  : ${r.parked} bags, avg declared dead after ${fmt(r.avgParkDays,0)}d; $${fmt(r.parkedCapital)} sent to hold -> MTM $${fmt(r.parkedMtm)}`);
    console.log(`Hold bucket heal: ${r.recovered}/${r.parked} parked bags later reached +${p.tpPct}% (median ${r.medRecover ?? '—'}d to recover)`);
    if (r.openBag) console.log(`Open cycle now  : avgCost $${fmt(r.openBag.avgCost)}, deployed $${fmt(r.openBag.capitalDeployed)}, mark $${fmt(r.openBag.mark)} (${r.openBag.uwPct>=0?'-':'+'}${fmt(Math.abs(r.openBag.uwPct))}%), open ${r.openBag.daysOpen}d`);
    return;
  }

  // SWEEP
  const rules: Rule[] = [
    { kind: 'none', thr: 0 },
    ...[60, 90, 120, 180, 270].map((t) => ({ kind: 'time' as const, thr: t })),
    ...[15, 20, 25, 30, 40].map((t) => ({ kind: 'dd' as const, thr: t })),
    ...[2, 3, 5, 8].map((t) => ({ kind: 'tier' as const, thr: t })),
  ];
  console.log(`\nrule      | winCyc | realized$ | parked | avgDeadAfter | parkCap$ | holdMTM$ | healed(med d) | maxStuck`);
  for (const rl of rules) {
    const r = run(candles, seedPeak, p, rl);
    const label = rl.kind === 'none' ? 'none' : `${rl.kind}:${rl.thr}`;
    const stuck = r.openBag ? `${r.openBag.daysOpen}d(open)` : `${r.maxWinDur}d`;
    console.log(
      `${label.padEnd(9)} | ${String(r.winCycles).padStart(6)} | ${fmt(r.realizedWins,0).padStart(9)} | ${String(r.parked).padStart(6)} | ${(fmt(r.avgParkDays,0)+'d').padStart(12)} | ${fmt(r.parkedCapital,0).padStart(8)} | ${fmt(r.parkedMtm,0).padStart(8)} | ${((r.recovered+'/'+r.parked)+(r.medRecover!=null?` (${r.medRecover})`:'')).padStart(13)} | ${stuck}`
    );
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
