/**
 * ETH SPOT ACCUMULATION via an EMA34 dip ladder — how to spread a recurring budget.
 *
 * Framing (the user's real goal): you add cash regularly and ACCUMULATE ETH. You never
 * sell at EMA34. So the question is not "return per cycle" but: does buying dips below
 * EMA34 give a better cost basis than just buying on a fixed schedule — and how much
 * capital should sit at each depth tier.
 *
 * Rules
 *   - Every `budgetEveryBars` bars, `budgetPerPeriod` USD is added to cash.
 *   - A cycle ARMS when a candle closes below EMA34 with no cycle open; it ENDS when a
 *     later candle's high >= EMA34. Cash at the cycle start is the base for tier sizing:
 *     tier i is allowed to spend weight_i% of that base.
 *   - Tier i fills at EMA34*(1 - depth_i/100). NO LOOKAHEAD: on the arming bar a tier can
 *     only fill at that bar's CLOSE (and only if the close is already at/below the level);
 *     on later bars an intra-candle touch of the level fills at the level.
 *   - Nothing is ever sold. Leftover cash keeps accruing.
 *   - `cashCapPeriods`: if cash exceeds that many periods of budget, the excess is
 *     force-deployed at the next bar's close (prevents hoarding cash forever in a bull
 *     run where price never revisits the deep tiers). 0 = no cap.
 *
 * Benchmarks
 *   - NAIVE DCA: spend the whole budget at the close every `budgetEveryBars` bars.
 *   - DIP-ONLY DCA: same schedule, but only buy when close < EMA34 (else roll cash over).
 *   - LUMP SUM: put every future contribution in at the first bar (upper bound in a bull).
 *
 * Reported: total contributed, units accumulated, average cost basis, final value,
 * ROI on contributions, idle cash at the end, and cost basis vs naive DCA (the number
 * that actually decides the ladder).
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema34-dca-accumulate-backtest.ts \
 *     [symbol] [intervals] [days] [budgetPerPeriod] [feePctPerSide] [emaPeriod] [cashCapPeriods]
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

function fmt(n: number, d = 2): string {
  if (!isFinite(n)) return '   -  ';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Ladder = { name: string; tiers: { depth: number; weight: number }[] };

type Result = {
  contributed: number;
  units: number;
  cash: number;
  finalValue: number;
  costBasis: number;
  fills: number[];
  buys: number;
};

function runAccumulation(
  candles: Candle[],
  e: number[],
  emaPeriod: number,
  ladder: Ladder,
  budgetPerPeriod: number,
  budgetEveryBars: number,
  feePerSide: number,
  cashCapPeriods: number,
): Result {
  const fee = feePerSide / 100;
  const nT = ladder.tiers.length;
  const fills = new Array(nT).fill(0);

  let cash = 0;
  let contributed = 0;
  let units = 0;
  let buys = 0;

  let open = false;
  let base = 0; // cash available at cycle start = sizing base
  const filled = new Array(nT).fill(false);

  const buy = (usd: number, price: number) => {
    if (usd <= 0 || !(price > 0)) return;
    const spend = Math.min(usd, cash);
    if (spend <= 0) return;
    cash -= spend;
    units += (spend * (1 - fee)) / price;
    buys++;
  };

  for (let i = emaPeriod; i < candles.length; i++) {
    const c = candles[i]!;
    const em = e[i]!;
    if (!isFinite(em) || em <= 0) continue;

    if ((i - emaPeriod) % budgetEveryBars === 0) {
      cash += budgetPerPeriod;
      contributed += budgetPerPeriod;
    }

    let armingBar = false;
    if (!open) {
      if (c.close < em) {
        open = true;
        armingBar = true;
        base = cash;
        filled.fill(false);
      }
    }

    if (open) {
      for (let t = 0; t < nT; t++) {
        if (filled[t]) continue;
        const level = em * (1 - ladder.tiers[t]!.depth / 100);
        let price = NaN;
        if (armingBar) {
          if (c.close <= level) price = c.close;
        } else if (c.low <= level) {
          price = level;
        }
        if (!isFinite(price)) continue;
        filled[t] = true;
        fills[t]++;
        buy(base * (ladder.tiers[t]!.weight / 100), price);
      }

      if (!armingBar && c.high >= em) open = false;
    }

    // Cash cap: don't hoard forever if the ladder never fills.
    if (cashCapPeriods > 0 && cash > cashCapPeriods * budgetPerPeriod) {
      buy(cash - cashCapPeriods * budgetPerPeriod, c.close);
    }
  }

  const lastClose = candles[candles.length - 1]!.close;
  const finalValue = units * lastClose + cash;
  return {
    contributed,
    units,
    cash,
    finalValue,
    costBasis: units > 0 ? (contributed - cash) / units : NaN,
    fills,
    buys,
  };
}

function runNaive(
  candles: Candle[],
  e: number[],
  emaPeriod: number,
  budgetPerPeriod: number,
  budgetEveryBars: number,
  feePerSide: number,
  dipOnly: boolean,
): Result {
  const fee = feePerSide / 100;
  let cash = 0, contributed = 0, units = 0, buys = 0;
  for (let i = emaPeriod; i < candles.length; i++) {
    const c = candles[i]!;
    const em = e[i]!;
    if (!isFinite(em)) continue;
    if ((i - emaPeriod) % budgetEveryBars === 0) {
      cash += budgetPerPeriod;
      contributed += budgetPerPeriod;
      if (!dipOnly || c.close < em) {
        units += (cash * (1 - fee)) / c.close;
        cash = 0;
        buys++;
      }
    }
  }
  const lastClose = candles[candles.length - 1]!.close;
  return {
    contributed,
    units,
    cash,
    finalValue: units * lastClose + cash,
    costBasis: units > 0 ? (contributed - cash) / units : NaN,
    fills: [],
    buys,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, budArg, feeArg, emaArg, capArg] = process.argv;
  const symbol = (symArg ?? 'ETHUSDT').toUpperCase();
  const intervals = (intArg ?? '1d,4h').split(',').map((s) => s.trim());
  const days = Number(daysArg ?? 2900);
  const budgetPerPeriod = Number(budArg ?? 100);
  const feePerSide = Number(feeArg ?? 0.05);
  const emaPeriod = Number(emaArg ?? 34);
  const cashCapPeriods = Number(capArg ?? 0);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  const laddersByTf: Record<string, Ladder[]> = {
    '1d': [
      { name: 'all @ close<EMA (d=0)', tiers: [{ depth: 0, weight: 100 }] },
      { name: 'flat 3 (3/7/12)', tiers: [{ depth: 3, weight: 33.34 }, { depth: 7, weight: 33.33 }, { depth: 12, weight: 33.33 }] },
      { name: 'flat 4 (3/6/10/16)', tiers: [{ depth: 3, weight: 25 }, { depth: 6, weight: 25 }, { depth: 10, weight: 25 }, { depth: 16, weight: 25 }] },
      { name: 'front 4 (40/30/20/10)', tiers: [{ depth: 3, weight: 40 }, { depth: 6, weight: 30 }, { depth: 10, weight: 20 }, { depth: 16, weight: 10 }] },
      { name: 'front 4 (50/25/15/10)', tiers: [{ depth: 2, weight: 50 }, { depth: 5, weight: 25 }, { depth: 9, weight: 15 }, { depth: 15, weight: 10 }] },
      { name: 'back 4 (10/20/30/40)', tiers: [{ depth: 3, weight: 10 }, { depth: 6, weight: 20 }, { depth: 10, weight: 30 }, { depth: 16, weight: 40 }] },
      { name: 'back 5 (10/15/20/25/30)', tiers: [{ depth: 3, weight: 10 }, { depth: 6, weight: 15 }, { depth: 10, weight: 20 }, { depth: 15, weight: 25 }, { depth: 22, weight: 30 }] },
      { name: 'shallow 3 (1/3/5)', tiers: [{ depth: 1, weight: 40 }, { depth: 3, weight: 35 }, { depth: 5, weight: 25 }] },
      { name: 'deep-only 3 (8/15/25)', tiers: [{ depth: 8, weight: 33.34 }, { depth: 15, weight: 33.33 }, { depth: 25, weight: 33.33 }] },
      { name: 'fill-weighted 4', tiers: [{ depth: 2, weight: 35 }, { depth: 5, weight: 30 }, { depth: 9, weight: 22 }, { depth: 15, weight: 13 }] },
    ],
    '4h': [
      { name: 'all @ close<EMA (d=0)', tiers: [{ depth: 0, weight: 100 }] },
      { name: 'flat 3 (1.5/3/6)', tiers: [{ depth: 1.5, weight: 33.34 }, { depth: 3, weight: 33.33 }, { depth: 6, weight: 33.33 }] },
      { name: 'flat 4 (1.5/3/5/8)', tiers: [{ depth: 1.5, weight: 25 }, { depth: 3, weight: 25 }, { depth: 5, weight: 25 }, { depth: 8, weight: 25 }] },
      { name: 'front 4 (40/30/20/10)', tiers: [{ depth: 1.5, weight: 40 }, { depth: 3, weight: 30 }, { depth: 5, weight: 20 }, { depth: 8, weight: 10 }] },
      { name: 'front 4 (50/25/15/10)', tiers: [{ depth: 1, weight: 50 }, { depth: 2.5, weight: 25 }, { depth: 4.5, weight: 15 }, { depth: 8, weight: 10 }] },
      { name: 'back 4 (10/20/30/40)', tiers: [{ depth: 1.5, weight: 10 }, { depth: 3, weight: 20 }, { depth: 5, weight: 30 }, { depth: 8, weight: 40 }] },
      { name: 'shallow 3 (0.5/1.5/3)', tiers: [{ depth: 0.5, weight: 40 }, { depth: 1.5, weight: 35 }, { depth: 3, weight: 25 }] },
      { name: 'deep-only 3 (4/7/12)', tiers: [{ depth: 4, weight: 33.34 }, { depth: 7, weight: 33.33 }, { depth: 12, weight: 33.33 }] },
      { name: 'fill-weighted 4', tiers: [{ depth: 1, weight: 35 }, { depth: 2.5, weight: 30 }, { depth: 4.5, weight: 22 }, { depth: 8, weight: 13 }] },
    ],
  };

  for (const interval of intervals) {
    const candles = await fetchKlines(symbol, interval, startMs, endMs);
    const closes = candles.map((c) => c.close);
    const e = ema(closes, emaPeriod);
    // Contribute monthly-ish on both timeframes so the two are comparable.
    const budgetEveryBars = interval === '1d' ? 30 : 180;
    const span = `${candles[0]!.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]!.openTime.toISOString().slice(0, 10)}`;

    console.log(`\n============ ${symbol} ${interval} | EMA${emaPeriod} | ${candles.length} candles (${span}) | $${budgetPerPeriod} every ${budgetEveryBars} bars | fee ${feePerSide}%/side | cashCap ${cashCapPeriods || 'none'} ============`);

    const naive = runNaive(candles, e, emaPeriod, budgetPerPeriod, budgetEveryBars, feePerSide, false);
    const dipOnly = runNaive(candles, e, emaPeriod, budgetPerPeriod, budgetEveryBars, feePerSide, true);
    const lastClose = candles[candles.length - 1]!.close;

    const row = (name: string, r: Result, fillStr = '') => {
      const roi = ((r.finalValue / r.contributed) - 1) * 100;
      const vsNaive = ((naive.costBasis - r.costBasis) / naive.costBasis) * 100; // + = cheaper basis
      const idle = (r.cash / r.contributed) * 100;
      console.log(
        `${name.padEnd(23)} | ${('$' + fmt(r.contributed, 0)).padStart(7)} | ${fmt(r.units, 4).padStart(9)} | ${('$' + fmt(r.costBasis, 0)).padStart(7)} | ${fmt(vsNaive, 1).padStart(9)} | ${('$' + fmt(r.finalValue, 0)).padStart(9)} | ${fmt(roi, 0).padStart(6)} | ${fmt(idle, 1).padStart(6)} | ${String(r.buys).padStart(5)} | ${fillStr}`,
      );
    };

    console.log('strategy                | contrib | units     | basis   | vs naive% | final$    | ROI%   | idle% | buys  | tier fills');
    row('NAIVE DCA (schedule)', naive);
    row('DIP-ONLY DCA', dipOnly);

    for (const L of laddersByTf[interval] ?? []) {
      const r = runAccumulation(candles, e, emaPeriod, L, budgetPerPeriod, budgetEveryBars, feePerSide, cashCapPeriods);
      const fillStr = r.fills.map((f, i) => `${L.tiers[i]!.depth}%:${f}`).join(' ');
      row(L.name, r, fillStr);
    }
    console.log(`(last close $${fmt(lastClose, 0)})`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
