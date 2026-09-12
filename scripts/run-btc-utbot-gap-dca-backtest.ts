/**
 * Backtest: DCA BTC dùng tín hiệu "gap tới đường UTBot" để quyết định MUA BAO NHIÊU.
 *
 * Bối cảnh: bài scan 2026-09-03-utbot-gap-bounce-stats.md tìm ra rằng khi giá nằm dưới
 * đường UTBot (kv=2) một khoảng >= ~12% thì xác suất hồi >= 5% trong 10 ngày là 82%
 * (so với 47% ở nhóm gap 4-6%). Câu hỏi ở đây: biến quan sát đó thành luật DCA thì có
 * thắng được DCA đều đặn không?
 *
 * Mọi chiến lược nhận CÙNG một dòng tiền vào (contribution hàng tháng), spot, long-only,
 * KHÔNG BÁN — đây là DCA tích luỹ dài hạn. Khác biệt duy nhất là luật giải ngân.
 *
 *   1. MONTHLY   — mua hết tiền tháng vào ngày 1. DCA kinh điển. Đây là mốc so sánh.
 *   2. DAILY     — chia đều mua mỗi ngày. Mốc so sánh mượt hơn.
 *   3. TIERED    — mỗi ngày mua 1 phần; gap 8-12% mua gấp 2; gap >= 12% mua gấp 3.
 *   4. WAIT      — dồn tiền mặt, chỉ giải ngân TOÀN BỘ khi gap >= ngưỡng.
 *   5. WAIT+FS   — như WAIT nhưng có failsafe: tiền nằm không quá N tháng thì mua bừa.
 *   6. DIPONLY   — ĐỐI CHỨNG: bỏ UTBot, chỉ mua khi giá thấp hơn đỉnh 30 ngày >= X%.
 *                  Nếu TIERED/WAIT không hơn được cái này thì gap UTBot không thêm gì.
 *
 * Tiền chưa giải ngân nằm ở dạng cash và ĐƯỢC TÍNH vào giá trị cuối — không có chuyện
 * giấu cash drag bằng cách chỉ khoe avgCost.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-utbot-gap-dca-backtest.ts [symbol] [startDate] [monthlyUsd] [feePctPerSide] [kv]
 *   e.g. ... run-btc-utbot-gap-dca-backtest.ts BTCUSDT 2018-01-01 200 0.05 2
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;

type Candle = { ts: number; date: string; y: number; m: number; open: number; high: number; low: number; close: number };

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

async function fetchKlines(symbol: string, startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=1d&startTime=${cursor}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      const ts = k[0] as number;
      const d = new Date(ts);
      out.push({
        ts,
        date: d.toISOString().slice(0, 10),
        y: d.getUTCFullYear(),
        m: d.getUTCMonth(),
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

function wilderAtr(c: Candle[], period: number): number[] {
  const tr = c.map((x, i) =>
    i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close)),
  );
  const atr = new Array(c.length).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;
  for (let i = period; i < c.length; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  return atr;
}

/** Same UTBot stop formula as scripts/run-flip-backtest.ts. */
function utBotStops(c: Candle[], period: number, keyValue: number): number[] {
  const atr = wilderAtr(c, period);
  const stop = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const nLoss = keyValue * atr[i]!;
    const close = c[i]!.close;
    const prevC = c[i - 1]!.close;
    const prev = stop[i - 1]!;
    if (close > prev && prevC > prev) stop[i] = Math.max(prev, close - nLoss);
    else if (close < prev && prevC < prev) stop[i] = Math.min(prev, close + nLoss);
    else if (close > prev) stop[i] = close - nLoss;
    else stop[i] = close + nLoss;
  }
  return stop;
}

type Ctx = { gap: number | null; dipPct: number; ddPct: number; belowEma: boolean; day: number };
type Rule = {
  name: string;
  note: string;
  buy: (cash: number, slice: number, ctx: Ctx) => number;
  /** Phần contribution giữ lại làm đạn dự phòng (0 = giải ngân hết như thường). */
  reserveFrac?: number;
  /** Khi nào bắn hết đạn dự phòng. */
  release?: (ctx: Ctx) => boolean;
};

function makeRules(thr: number, boost: number, failsafeMonths: number, dipThr: number): Rule[] {
  return [
    {
      name: 'MONTHLY',
      note: 'mua hết tiền tháng vào ngày 1',
      buy: (cash, _slice, ctx) => (ctx.day === 0 ? cash : 0),
    },
    {
      name: 'DAILY',
      note: 'chia đều mua mỗi ngày',
      buy: (cash, slice) => Math.min(cash, slice),
    },
    {
      name: 'TIERED',
      note: `gap ${boost}-${thr}% mua x2, gap>=${thr}% mua x3`,
      buy: (cash, slice, ctx) => {
        const g = ctx.gap;
        const mult = g === null ? 1 : g >= thr ? 3 : g >= boost ? 2 : 1;
        return Math.min(cash, slice * mult);
      },
    },
    {
      name: 'WAIT',
      note: `dồn tiền, giải ngân hết khi gap>=${thr}%`,
      buy: (cash, _slice, ctx) => (ctx.gap !== null && ctx.gap >= thr ? cash : 0),
    },
    {
      name: 'WAIT+FS',
      note: `như WAIT, failsafe ${failsafeMonths} tháng`,
      buy: (cash, slice, ctx) =>
        ctx.gap !== null && ctx.gap >= thr ? cash : cash >= slice * 30 * failsafeMonths ? cash : 0,
    },
    {
      name: 'RES-DD',
      note: 'để dành 50%, bắn hết khi giảm >=30% từ đỉnh',
      buy: (cash, slice) => Math.min(cash, slice),
      reserveFrac: 0.5,
      release: (ctx) => ctx.ddPct >= 30,
    },
    {
      name: 'RES-GAP',
      note: `để dành 50%, bắn hết khi gap>=${thr}%`,
      buy: (cash, slice) => Math.min(cash, slice),
      reserveFrac: 0.5,
      release: (ctx) => ctx.gap !== null && ctx.gap >= thr,
    },
    {
      name: 'EMA200',
      note: 'mua x2 khi giá dưới EMA200',
      buy: (cash, slice, ctx) => Math.min(cash, slice * (ctx.belowEma ? 2 : 1)),
    },
    {
      name: 'DDTIER',
      note: 'nhân theo mức giảm từ đỉnh: <10%=1x, 10-30%=1.5x, 30-50%=2x, >50%=3x',
      buy: (cash, slice, ctx) => {
        const d = ctx.ddPct;
        const mult = d >= 50 ? 3 : d >= 30 ? 2 : d >= 10 ? 1.5 : 1;
        return Math.min(cash, slice * mult);
      },
    },
    {
      name: 'DIPONLY',
      note: `ĐỐI CHỨNG: mua hết khi giá <= đỉnh30d -${dipThr}%`,
      buy: (cash, _slice, ctx) => (ctx.dipPct >= dipThr ? cash : 0),
    },
  ];
}

type Result = {
  name: string;
  note: string;
  contributed: number;
  btc: number;
  cost: number;
  avgCost: number;
  endValue: number;
  retPct: number;
  idlePct: number;
  maxDD: number;
  buys: number;
};

function ema(c: Candle[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(c.length).fill(null);
  let prev = 0;
  for (let i = 0; i < c.length; i++) {
    prev = i === 0 ? c[0]!.close : c[i]!.close * k + prev * (1 - k);
    out[i] = i >= period ? prev : null;
  }
  return out;
}

function simulate(rule: Rule, c: Candle[], gaps: (number | null)[], s0: number, monthly: number, fee: number): Result {
  const ema200 = ema(c, 200);
  let ath = 0;
  let cash = 0;
  let reserve = 0;
  const resFrac = rule.reserveFrac ?? 0;
  let btc = 0;
  let cost = 0;
  let contributed = 0;
  let buys = 0;
  let idleDays = 0;
  let peak = 0;
  let maxDD = 0;
  let prevMonth = -1;
  let dayOfMonth = 0;

  for (let i = s0; i < c.length; i++) {
    const bar = c[i]!;
    if (bar.m !== prevMonth) {
      cash += monthly * (1 - resFrac);
      reserve += monthly * resFrac;
      contributed += monthly;
      prevMonth = bar.m;
      dayOfMonth = 0;
    }

    // Giá thấp hơn đỉnh 30 ngày bao nhiêu % — dùng cho nhánh đối chứng.
    let hi = 0;
    for (let j = Math.max(0, i - 30); j <= i; j++) hi = Math.max(hi, c[j]!.high);
    const dipPct = ((hi - bar.close) / hi) * 100;
    // Mức giảm so với đỉnh mọi thời đại tính tới hôm đó (chỉ dùng dữ liệu quá khứ).
    ath = Math.max(ath, bar.high);
    const ddPct = ((ath - bar.close) / ath) * 100;
    const belowEma = ema200[i] !== null && bar.close < ema200[i]!;

    const ctx: Ctx = { gap: gaps[i]!, dipPct, ddPct, belowEma, day: dayOfMonth };
    const slice = (monthly / 30) * (1 - resFrac);
    let spend = Math.min(cash, Math.max(0, rule.buy(cash, slice, ctx)));
    cash -= spend;
    // Đạn dự phòng bắn một lần khi điều kiện bật, cộng vào cùng ngày.
    if (rule.release && reserve > 0 && rule.release(ctx)) {
      spend += reserve;
      reserve = 0;
    }
    if (spend > 0) {
      btc += (spend * (1 - fee)) / bar.close;
      cost += spend;
      buys++;
    }

    const idle = cash + reserve;
    const value = btc * bar.close + idle;
    if (idle > 0.01) idleDays += idle / Math.max(value, 1e-9);
    peak = Math.max(peak, value);
    // DD chỉ có nghĩa sau khi đã bỏ tiền vào; so với đỉnh giá trị danh mục.
    if (peak > 0) maxDD = Math.max(maxDD, ((peak - value) / peak) * 100);
    dayOfMonth++;
  }

  const last = c[c.length - 1]!.close;
  const endValue = btc * last + cash + reserve;
  const days = c.length - s0;
  return {
    name: rule.name,
    note: rule.note,
    contributed,
    btc,
    cost,
    avgCost: btc > 0 ? cost / btc : NaN,
    endValue,
    retPct: ((endValue - contributed) / contributed) * 100,
    idlePct: (idleDays / days) * 100,
    maxDD,
    buys,
  };
}

const money = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;

function printTable(title: string, rows: Result[]) {
  console.log(`\n${title}`);
  console.log(
    '  ' +
      'chiến lược'.padEnd(10) +
      'nạp vào'.padStart(10) +
      'giá trị cuối'.padStart(14) +
      'lãi %'.padStart(9) +
      'BTC'.padStart(10) +
      'giá TB'.padStart(11) +
      'cash nằm không'.padStart(16) +
      'maxDD'.padStart(8) +
      'lần mua'.padStart(9),
  );
  const base = rows[0]!;
  for (const r of rows) {
    const vs = r === base ? '' : `  (${r.endValue >= base.endValue ? '+' : ''}${money(r.endValue - base.endValue)} vs MONTHLY)`;
    console.log(
      '  ' +
        r.name.padEnd(10) +
        money(r.contributed).padStart(10) +
        money(r.endValue).padStart(14) +
        `${r.retPct.toFixed(1)}%`.padStart(9) +
        r.btc.toFixed(4).padStart(10) +
        money(r.avgCost).padStart(11) +
        `${r.idlePct.toFixed(0)}%`.padStart(16) +
        `${r.maxDD.toFixed(1)}%`.padStart(8) +
        String(r.buys).padStart(9) +
        vs,
    );
  }
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const startDate = process.argv[3] ?? '2018-01-01';
  const monthly = Number(process.argv[4] ?? 200);
  const fee = Number(process.argv[5] ?? 0.05) / 100;
  const kv = Number(process.argv[6] ?? 2);

  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const all = await fetchKlines(symbol, startMs - 400 * 86400_000, Date.now());
  const s0 = all.findIndex((c) => c.ts >= startMs);
  if (s0 < 0) throw new Error('không đủ dữ liệu');

  const stop = utBotStops(all, ATR_PERIOD, kv);
  const gaps = all.map((c, i) =>
    i < ATR_PERIOD || stop[i] === 0 || c.close > stop[i]! ? null : ((stop[i]! - c.close) / c.close) * 100,
  );

  console.log(`${symbol} 1d  |  ${all[s0]!.date} -> ${all[all.length - 1]!.date}  (${all.length - s0} ngày)`);
  console.log(`Nạp ${money(monthly)}/tháng · phí ${(fee * 100).toFixed(2)}%/chiều · UTBot ATR(${ATR_PERIOD}) kv=${kv} · KHÔNG BÁN`);

  const THR = 12;
  const BOOST = 8;
  const rules = makeRules(THR, BOOST, 6, 15);

  printTable(`=== TOÀN GIAI ĐOẠN (ngưỡng gap ${THR}%, tăng tốc từ ${BOOST}%) ===`, rules.map((r) => simulate(r, all, gaps, s0, monthly, fee)));

  // --- quét ngưỡng cho TIERED và WAIT
  console.log(`\n=== Quét ngưỡng gap (giá trị cuối) ===`);
  console.log('  ngưỡng' + 'TIERED'.padStart(14) + 'WAIT'.padStart(14) + 'WAIT+FS'.padStart(14) + '   (MONTHLY = ' + money(simulate(rules[0]!, all, gaps, s0, monthly, fee).endValue) + ')');
  for (const t of [6, 8, 10, 12, 15, 20]) {
    const rs = makeRules(t, Math.max(2, t - 4), 6, 15);
    const tiered = simulate(rs[2]!, all, gaps, s0, monthly, fee);
    const wait = simulate(rs[3]!, all, gaps, s0, monthly, fee);
    const wfs = simulate(rs[4]!, all, gaps, s0, monthly, fee);
    console.log(
      `  >=${String(t).padStart(2)}%` +
        money(tiered.endValue).padStart(14) +
        money(wait.endValue).padStart(14) +
        money(wfs.endValue).padStart(14),
    );
  }

  // --- out-of-sample theo giai đoạn
  console.log(`\n=== OUT-OF-SAMPLE: cùng luật, 3 giai đoạn tách rời ===`);
  const periods: [string, string][] = [
    ['2018-01-01', '2020-12-31'],
    ['2021-01-01', '2023-12-31'],
    ['2024-01-01', '2026-12-31'],
  ];
  for (const [from, to] of periods) {
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T23:59:59Z`);
    const sub = all.filter((c) => c.ts <= b);
    const i0 = sub.findIndex((c) => c.ts >= a);
    if (i0 < 0 || sub.length - i0 < 120) continue;
    const subStop = utBotStops(sub, ATR_PERIOD, kv);
    const subGaps = sub.map((c, i) =>
      i < ATR_PERIOD || subStop[i] === 0 || c.close > subStop[i]! ? null : ((subStop[i]! - c.close) / c.close) * 100,
    );
    printTable(`--- ${from} → ${sub[sub.length - 1]!.date} ---`, rules.map((r) => simulate(r, sub, subGaps, i0, monthly, fee)));
  }

  // --- độ nhạy theo keyValue
  console.log(`\n=== Độ nhạy theo keyValue (TIERED, ngưỡng ${THR}%) ===`);
  for (const k of [1, 2, 3]) {
    const st = utBotStops(all, ATR_PERIOD, k);
    const gp = all.map((c, i) => (i < ATR_PERIOD || st[i] === 0 || c.close > st[i]! ? null : ((st[i]! - c.close) / c.close) * 100));
    const r = simulate(rules[2]!, all, gp, s0, monthly, fee);
    console.log(`  kv=${k}: ${money(r.endValue).padStart(10)}  (lãi ${r.retPct.toFixed(1)}%, giá TB ${money(r.avgCost)})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
