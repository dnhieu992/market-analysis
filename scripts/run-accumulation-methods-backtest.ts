/**
 * MAXIMISE COIN ACCUMULATION — which buying method ends with the most BTC / ETH?
 *
 * Objective (the user's): not return, not drawdown — the number of COINS owned per
 * dollar contributed. Nothing is ever sold.
 *
 * Fair comparison rules
 *   - Every method receives the SAME cash on the SAME schedule ($X per `contribBars`).
 *     A method only chooses WHEN to spend it. Cash not spent rolls over.
 *   - Primary metric = "coin-equivalent" = units + leftoverCash / lastPrice, i.e. what
 *     you'd own if you gave up and bought the rest at the end. Without this, a method
 *     that simply hoards cash would look artificially good/bad depending on the end date.
 *   - Reported as % vs the naive "buy the moment cash arrives" baseline.
 *   - Sub-periods are reported too, because the ranking is regime dependent.
 *
 * Methods
 *   immediate-*        buy everything the moment cash arrives (monthly / weekly / daily)
 *   dip-EMA34          hold cash, deploy it all on the first close below EMA34
 *   ladder-EMA34       resting limits at -2/-5/-9/-15% below EMA34 (35/30/22/13% of cash)
 *   below-MA200        deploy only while close < MA200
 *   depth-scaled       spend a MULTIPLE of the budget based on how far below MA200 price
 *                      is (cheap → spend more, expensive → hold back), capped by cash
 *   rsi-oversold       deploy while RSI(14) < threshold
 *   value-averaging    target portfolio value grows linearly; buy the shortfall (buy-only)
 *
 * No lookahead: every decision uses the CURRENT bar's close and indicators computed from
 * closes up to that bar, and buys at that same close. Ladder limits rest on later bars.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-accumulation-methods-backtest.ts \
 *     [symbols] [days] [budgetPerMonth] [feePctPerSide]
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

function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function sma(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function rsi(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / period, al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function fmt(n: number, d = 2): string {
  if (!isFinite(n)) return '   -  ';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Ctx = {
  candles: Candle[];
  e34: number[];
  ma200: number[];
  r14: number[];
  fee: number;
  start: number;
  end: number;
  budgetPerMonth: number;
};

type Run = { units: number; cash: number; contributed: number; buys: number };

/**
 * Generic driver. `decide` returns the USD amount to spend at this bar's close
 * (clamped to available cash by the caller). `onBar` runs before the decision so a
 * method can place resting limit orders.
 */
function simulate(
  ctx: Ctx,
  contribBars: number,
  decide: (i: number, cash: number, state: Run) => number,
  limitFill?: (i: number, cash: number, state: Run) => { usd: number; price: number }[],
): Run {
  const { candles, fee, start, end } = ctx;
  // Same total contribution regardless of frequency.
  const perContrib = (ctx.budgetPerMonth * contribBars) / 30;
  const st: Run = { units: 0, cash: 0, contributed: 0, buys: 0 };

  for (let i = start; i <= end; i++) {
    if ((i - start) % contribBars === 0) {
      st.cash += perContrib;
      st.contributed += perContrib;
    }

    if (limitFill) {
      for (const f of limitFill(i, st.cash, st)) {
        const spend = Math.min(f.usd, st.cash);
        if (spend > 0 && f.price > 0) {
          st.cash -= spend;
          st.units += (spend * (1 - fee)) / f.price;
          st.buys++;
        }
      }
    }

    const want = decide(i, st.cash, st);
    const spend = Math.min(want, st.cash);
    if (spend > 0) {
      st.cash -= spend;
      st.units += (spend * (1 - fee)) / candles[i]!.close;
      st.buys++;
    }
  }
  return st;
}

function ladderEma34(ctx: Ctx, contribBars: number): Run {
  const tiers = [
    { depth: 2, weight: 35 },
    { depth: 5, weight: 30 },
    { depth: 9, weight: 22 },
    { depth: 15, weight: 13 },
  ];
  const { candles, e34 } = ctx;
  let open = false;
  let base = 0;
  const filled = new Array(tiers.length).fill(false);
  let armedAt = -1;

  return simulate(
    ctx,
    contribBars,
    (i, cash) => {
      // Deploy the remainder if the ladder has been sitting unfilled for ~2 months.
      if (open && armedAt >= 0 && i - armedAt > 60 && cash > 0) {
        open = false;
        return cash;
      }
      return 0;
    },
    (i, cash, st) => {
      const em = ctx.e34[i]!;
      const c = candles[i]!;
      if (!isFinite(em) || em <= 0) return [];
      const out: { usd: number; price: number }[] = [];

      let arming = false;
      if (!open && c.close < em) {
        open = true;
        arming = true;
        armedAt = i;
        base = cash;
        filled.fill(false);
      }
      if (!open) return out;

      for (let t = 0; t < tiers.length; t++) {
        if (filled[t]) continue;
        const level = em * (1 - tiers[t]!.depth / 100);
        let price = NaN;
        if (arming) {
          if (c.close <= level) price = c.close;
        } else if (c.low <= level) price = level;
        if (!isFinite(price)) continue;
        filled[t] = true;
        out.push({ usd: base * (tiers[t]!.weight / 100), price });
      }
      if (!arming && c.high >= em) open = false;
      return out;
    },
  );
}

function valueAveraging(ctx: Ctx, contribBars: number): Run {
  // Target value grows by the contribution amount each period; buy the shortfall only.
  const perContrib = (ctx.budgetPerMonth * contribBars) / 30;
  let periods = 0;
  return simulate(ctx, contribBars, (i, cash, st) => {
    if ((i - ctx.start) % contribBars !== 0) return 0;
    periods++;
    const target = perContrib * periods;
    const current = st.units * ctx.candles[i]!.close;
    const gap = target - current;
    return gap > 0 ? Math.min(gap, cash) : 0; // buy-only: never sell the surplus
  });
}

async function main() {
  const [, , symArg, daysArg, budArg, feeArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT,ETHUSDT').split(',').map((s) => s.trim().toUpperCase());
  const days = Number(daysArg ?? 2900);
  const budgetPerMonth = Number(budArg ?? 100);
  const fee = Number(feeArg ?? 0.05) / 100;

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  for (const symbol of symbols) {
    const candles = await fetchKlines(symbol, '1d', startMs, endMs);
    const closes = candles.map((c) => c.close);
    const ctxBase = {
      candles,
      e34: ema(closes, 34),
      ma200: sma(closes, 200),
      r14: rsi(closes, 14),
      fee,
      budgetPerMonth,
    };

    // Warm-up: MA200 needs 200 bars, so every method starts on the same bar.
    const startIdx = 200;
    const periods: { name: string; from: number; to: number }[] = [
      { name: 'FULL', from: startIdx, to: candles.length - 1 },
    ];
    // Split the remainder into calendar chunks for the regime view.
    const chunks: [string, string, string][] = [
      ['2019-2020 chop', '2019-01-01', '2020-10-01'],
      ['2020-21 bull', '2020-10-01', '2021-11-10'],
      ['2022 bear', '2021-11-10', '2023-01-01'],
      ['2023-26 recovery', '2023-01-01', '2026-07-26'],
    ];
    for (const [name, a, b] of chunks) {
      const from = candles.findIndex((c) => c.openTime >= new Date(a));
      const to = candles.findIndex((c) => c.openTime >= new Date(b));
      if (from >= startIdx && to > from) periods.push({ name, from, to: to - 1 });
    }

    for (const p of periods) {
      const lastPrice = candles[p.to]!.close;
      // The exact contribution dates are luck. Average over 30 start offsets so a method
      // is not credited for happening to buy on good days.
      const OFFSETS = 30;
      const perMethod = new Map<string, number[]>();
      const perMethodBasis = new Map<string, number[]>();
      const perMethodIdle = new Map<string, number[]>();
      const perMethodBuys = new Map<string, number[]>();
      let contributedRef = 0;

      for (let off = 0; off < OFFSETS; off++) {
        if (p.from + off > p.to) break;
        const ctx: Ctx = { ...ctxBase, start: p.from + off, end: p.to };
        const coinEq = (r: Run) => r.units + r.cash / lastPrice;
        for (const { name, r } of buildMethods(ctx, closes, budgetPerMonth)) {
          // coins per $1000 contributed — comparable across offsets.
          const per1k = (coinEq(r) / r.contributed) * 1000;
          if (!perMethod.has(name)) {
            perMethod.set(name, []);
            perMethodBasis.set(name, []);
            perMethodIdle.set(name, []);
            perMethodBuys.set(name, []);
          }
          perMethod.get(name)!.push(per1k);
          perMethodBasis.get(name)!.push(r.units > 0 ? (r.contributed - r.cash) / r.units : NaN);
          perMethodIdle.get(name)!.push((r.cash / r.contributed) * 100);
          perMethodBuys.get(name)!.push(r.buys);
          contributedRef = r.contributed;
        }
      }

      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const names = [...perMethod.keys()];
      const baseline = avg(perMethod.get(names[0]!)!);
      console.log(
        `\n=== ${symbol} | ${p.name} | ${candles[p.from]!.openTime.toISOString().slice(0, 10)} → ${candles[p.to]!.openTime.toISOString().slice(0, 10)} | $${budgetPerMonth}/mo | ~$${fmt(contributedRef, 0)} total | avg of ${OFFSETS} start offsets ===`,
      );
      console.log('method               | coins/$1k | vs base% | spread%  | avg cost | idle% | buys');
      for (const name of names) {
        const vals = perMethod.get(name)!;
        const m = avg(vals);
        const spread = ((Math.max(...vals) - Math.min(...vals)) / m) * 100;
        console.log(
          `${name.padEnd(20)} | ${fmt(m, 5).padStart(9)} | ${fmt(((m / baseline) - 1) * 100, 2).padStart(8)} | ${fmt(spread, 1).padStart(7)}% | ${('$' + fmt(avg(perMethodBasis.get(name)!), 0)).padStart(8)} | ${fmt(avg(perMethodIdle.get(name)!), 1).padStart(5)} | ${fmt(avg(perMethodBuys.get(name)!), 0).padStart(4)}`,
        );
      }
    }
  }
  console.log('');
}

function buildMethods(ctx: Ctx, closes: number[], budgetPerMonth: number): { name: string; r: Run }[] {
      return [
        { name: 'immediate monthly', r: simulate(ctx, 30, (i, cash) => cash) },
        { name: 'immediate weekly', r: simulate(ctx, 7, (i, cash) => cash) },
        { name: 'immediate daily', r: simulate(ctx, 1, (i, cash) => cash) },
        {
          name: 'dip-EMA34 (all-in)',
          r: simulate(ctx, 30, (i, cash) => (closes[i]! < ctx.e34[i]! ? cash : 0)),
        },
        { name: 'ladder-EMA34 4 tiers', r: ladderEma34(ctx, 30) },
        {
          name: 'below-MA200 only',
          r: simulate(ctx, 30, (i, cash) => (closes[i]! < ctx.ma200[i]! ? cash : 0)),
        },
        {
          name: 'depth-scaled MA200',
          r: simulate(ctx, 30, (i, cash) => {
            const m = ctx.ma200[i]!;
            if (!isFinite(m)) return cash;
            const dev = (m - closes[i]!) / m; // >0 = below MA200
            const mult = dev > 0.2 ? 3 : dev > 0.1 ? 2 : dev > 0 ? 1.5 : dev > -0.2 ? 0.7 : 0.4;
            return Math.min(cash, ((budgetPerMonth * mult) as number));
          }),
        },
        {
          name: 'RSI14 < 45',
          r: simulate(ctx, 30, (i, cash) => (ctx.r14[i]! < 45 ? cash : 0)),
        },
        {
          name: 'RSI14 < 35',
          r: simulate(ctx, 30, (i, cash) => (ctx.r14[i]! < 35 ? cash : 0)),
        },
        { name: 'value averaging', r: valueAveraging(ctx, 30) },
    // Hybrids: never hoard everything — buy a fixed share on arrival, keep a small
    // reserve for dips, and force-deploy the reserve if no dip shows up in ~2 months.
    { name: '70% now +30% dip', r: hybridReserve(ctx, 0.7, 5, 60) },
    { name: '50% now +50% dip', r: hybridReserve(ctx, 0.5, 5, 60) },
    { name: '80% now +20% deep', r: hybridReserve(ctx, 0.8, 10, 60) },
  ];
}

/**
 * Buy `nowShare` of each contribution immediately; hold the rest as a dip reserve that
 * deploys when price trades `dipPct`% below EMA34, or unconditionally after
 * `deadlineBars` bars so cash never sits forever.
 */
function hybridReserve(ctx: Ctx, nowShare: number, dipPct: number, deadlineBars: number): Run {
  const contribBars = 30;
  const perContrib = (ctx.budgetPerMonth * contribBars) / 30;
  let reserve = 0;
  let reserveAge = 0;

  return simulate(ctx, contribBars, (i, cash) => {
    const isContrib = (i - ctx.start) % contribBars === 0;
    let spend = 0;
    if (isContrib) {
      spend += perContrib * nowShare;
      reserve += perContrib * (1 - nowShare);
    }
    if (reserve > 0) {
      reserveAge++;
      const em = ctx.e34[i]!;
      const trigger = isFinite(em) && ctx.candles[i]!.close <= em * (1 - dipPct / 100);
      if (trigger || reserveAge >= deadlineBars) {
        spend += reserve;
        reserve = 0;
        reserveAge = 0;
      }
    }
    return Math.min(spend, cash);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
