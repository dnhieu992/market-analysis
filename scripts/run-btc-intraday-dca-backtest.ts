/**
 * BTC INTRADAY DCA — "scan biên độ ngày → 5 điểm mua DCA → đóng bắt buộc 23:00 UTC+7".
 *
 * User's idea:
 *   - Mỗi ngày (theo giờ VN, UTC+7) đặt ~5 lệnh mua DCA nằm DƯỚI giá mở cửa ngày.
 *   - "Scan biên độ tăng/giảm trong ngày": lấy biên độ GIẢM trong ngày trung bình của
 *     N ngày gần nhất (open→low, %) để quyết định 5 mức mua sâu tới đâu (KHÔNG nhìn trước).
 *   - KHÔNG stop-loss.
 *   - Đóng toàn bộ vị thế BẮT BUỘC lúc 23:00 UTC+7 (= 16:00 UTC).
 *
 * Định nghĩa ngày:
 *   - Ngày VN bắt đầu 00:00 UTC+7 = 17:00 UTC (hôm trước).
 *   - Giá tham chiếu "open" = open của nến 17:00 UTC.
 *   - Cửa sổ khớp lệnh: các nến 15m có openTime trong [17:00 UTC, 16:00 UTC hôm sau).
 *   - Đóng bắt buộc: tại OPEN của nến 16:00 UTC (= 23:00 UTC+7).
 *
 * Đặt 5 mức DCA:
 *   - downAmp = trung bình N ngày trước của (dayOpen - dayLow)/dayOpen  (%). Không lookahead.
 *   - deepest = k × downAmp.  5 mức chia đều: level_i = deepest × i/5, i=1..5.
 *     → mức mua = dayOpen × (1 - level_i/100). Mỗi mức 1/5 vốn ngày.
 *   - Nến nào có low ≤ mức → khớp tại đúng mức (giả định limit order).
 *
 * Fee 0.05%/side. Vốn $1000 compound. Vốn tái sử dụng mỗi ngày (không giữ qua đêm).
 *
 * Benchmark: (a) mua tại open bán tại forced-close mỗi ngày; (b) Buy & Hold cả kỳ.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-intraday-dca-backtest.ts [symbol] [days] [feePctPerSide] [lookbackDays]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const INTERVAL = '15m';
const DAY_MS = 864e5;
const HOUR_MS = 36e5;
const CAPITAL = 1000;
const N_LEVELS = 5;

// Cửa sổ mặc định: 00:00 UTC → 16:00 UTC (đóng bắt buộc 16:00 UTC = 23:00 UTC+7).
// Có thể override qua argv[6]=startHourUTC, argv[7]=windowHours (để so sánh khung giờ khác).
const DAY_START_UTC_HOUR = Number(process.argv[6] ?? 0);
const WINDOW_HOURS = Number(process.argv[7] ?? 16);

type Candle = { open: number; high: number; low: number; close: number; t: number };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = []; let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ t: k[0] as number, open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string) });
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}
const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));

// Mốc 17:00-UTC gần nhất <= t (ms). Nếu giờ UTC < 17, thuộc ngày bắt đầu 17:00 hôm trước.
function dayStartMs(t: number): number {
  const d = new Date(t);
  const anchor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAY_START_UTC_HOUR, 0, 0, 0);
  return t >= anchor ? anchor : anchor - DAY_MS;
}

type Day = { start: number; candles: Candle[]; open: number; low: number; downAmp: number; closeCandle: Candle | null };

// Nhóm nến 15m theo ngày VN. closeCandle = nến có openTime == start + 23h (16:00 UTC).
function groupDays(c: Candle[]): Day[] {
  const map = new Map<number, Candle[]>();
  for (const k of c) {
    const s = dayStartMs(k.t);
    if (!map.has(s)) map.set(s, []);
    map.get(s)!.push(k);
  }
  const days: Day[] = [];
  for (const [start, cands] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    cands.sort((a, b) => a.t - b.t);
    const closeMs = start + WINDOW_HOURS * HOUR_MS;
    const closeCandle = cands.find((x) => x.t === closeMs) ?? null;
    // window = nến trước forced-close để khớp lệnh mua
    const win = cands.filter((x) => x.t >= start && x.t < closeMs);
    if (win.length === 0) continue;
    const open = win[0]!.open;
    let low = Infinity;
    for (const x of win) if (x.low < low) low = x.low;
    days.push({ start, candles: win, open, low, downAmp: ((open - low) / open) * 100, closeCandle });
  }
  return days;
}

type Cfg = { name: string; k: number; fixedLevels?: number[] };
type Res = {
  name: string; finalEquity: number; retPct: number;
  tradedDays: number; winDays: number; avgFills: number; fullFillDays: number;
  maxDayLossPct: number; maxDayGainPct: number; maxEquityDD: number; avgDailyRetPct: number;
};

function run(days: Day[], cfg: Cfg, fee: number, lookback: number): Res {
  const f = fee / 100;
  let equity = CAPITAL;
  let equityPeak = CAPITAL, maxEquityDD = 0;
  let tradedDays = 0, winDays = 0, totalFills = 0, fullFillDays = 0;
  let maxDayLossPct = 0, maxDayGainPct = 0, sumDailyRet = 0, dayCount = 0;

  for (let d = 0; d < days.length; d++) {
    const day = days[d]!;
    if (!day.closeCandle) continue;           // cần giá đóng bắt buộc
    // downAmp = trung bình N ngày TRƯỚC (không lookahead)
    let levels: number[];
    if (cfg.fixedLevels) {
      levels = cfg.fixedLevels;
    } else {
      if (d < lookback) continue;
      let sum = 0;
      for (let j = d - lookback; j < d; j++) sum += days[j]!.downAmp;
      const avgDown = sum / lookback;
      const deepest = cfg.k * avgDown;
      levels = [];
      for (let i = 1; i <= N_LEVELS; i++) levels.push((deepest * i) / N_LEVELS);
    }

    const perLevel = equity / N_LEVELS;       // vốn mỗi mức = 1/5 equity hiện tại
    const fillPrices: number[] = [];
    const filled = new Array(levels.length).fill(false);
    // duyệt nến trong ngày, khớp mức chưa khớp khi low chạm
    for (const k of day.candles) {
      for (let li = 0; li < levels.length; li++) {
        if (filled[li]) continue;
        const price = day.open * (1 - levels[li]! / 100);
        if (k.low <= price) { filled[li] = true; fillPrices.push(price); }
      }
    }
    const nFills = fillPrices.length;
    if (nFills === 0) { // không khớp gì → equity không đổi, vẫn tính là "ngày không giao dịch"
      const eq = equity; equityPeak = Math.max(equityPeak, eq); maxEquityDD = Math.max(maxEquityDD, (equityPeak - eq) / equityPeak);
      continue;
    }
    tradedDays++; totalFills += nFills;
    if (nFills === levels.length) fullFillDays++;

    // Mỗi mức mua perLevel $, đóng toàn bộ tại open nến 16:00 UTC.
    const exitPx = day.closeCandle.open;
    let dayPnl = 0;
    for (const fp of fillPrices) {
      const qty = (perLevel * (1 - f)) / fp;   // fee mua
      const proceeds = qty * exitPx * (1 - f); // fee bán
      dayPnl += proceeds - perLevel;
    }
    const deployed = perLevel * nFills;
    const dayRetOnDeployed = (dayPnl / deployed) * 100;
    equity += dayPnl;
    if (dayPnl > 0) winDays++;
    maxDayLossPct = Math.min(maxDayLossPct, dayRetOnDeployed);
    maxDayGainPct = Math.max(maxDayGainPct, dayRetOnDeployed);
    sumDailyRet += dayRetOnDeployed; dayCount++;

    const eq = equity; equityPeak = Math.max(equityPeak, eq); maxEquityDD = Math.max(maxEquityDD, (equityPeak - eq) / equityPeak);
  }

  return {
    name: cfg.name, finalEquity: equity, retPct: (equity / CAPITAL - 1) * 100,
    tradedDays, winDays, avgFills: tradedDays ? totalFills / tradedDays : 0, fullFillDays,
    maxDayLossPct, maxDayGainPct, maxEquityDD: maxEquityDD * 100,
    avgDailyRetPct: dayCount ? sumDailyRet / dayCount : 0,
  };
}

// Benchmark: mỗi ngày mua toàn bộ equity tại day-open, bán tại forced-close.
function benchOpenClose(days: Day[], fee: number): Res {
  const f = fee / 100;
  let equity = CAPITAL, equityPeak = CAPITAL, maxEquityDD = 0;
  let winDays = 0, tradedDays = 0, maxL = 0, maxG = 0, sumRet = 0, cnt = 0;
  for (const day of days) {
    if (!day.closeCandle) continue;
    const entry = day.open, exit = day.closeCandle.open;
    const qty = (equity * (1 - f)) / entry;
    const proceeds = qty * exit * (1 - f);
    const pnl = proceeds - equity;
    const ret = (pnl / equity) * 100;
    equity += pnl; tradedDays++; if (pnl > 0) winDays++;
    maxL = Math.min(maxL, ret); maxG = Math.max(maxG, ret); sumRet += ret; cnt++;
    equityPeak = Math.max(equityPeak, equity); maxEquityDD = Math.max(maxEquityDD, (equityPeak - equity) / equityPeak);
  }
  return { name: 'Bench: buy open / sell 23h', finalEquity: equity, retPct: (equity / CAPITAL - 1) * 100, tradedDays, winDays, avgFills: 1, fullFillDays: tradedDays, maxDayLossPct: maxL, maxDayGainPct: maxG, maxEquityDD: maxEquityDD * 100, avgDailyRetPct: cnt ? sumRet / cnt : 0 };
}

function printRow(r: Res) {
  const wr = r.tradedDays ? (r.winDays / r.tradedDays) * 100 : 0;
  console.log(
    `${r.name.padEnd(34)} ${usd(r.finalEquity - CAPITAL).padStart(11)} ${((r.retPct >= 0 ? '+' : '') + fmt(r.retPct, 1) + '%').padStart(9)} | ` +
    `days ${String(r.tradedDays).padStart(3)} · win ${(fmt(wr, 0) + '%').padStart(4)} · avgFill ${fmt(r.avgFills, 1)}/${N_LEVELS} · full ${String(r.fullFillDays).padStart(3)} | ` +
    `avgDay ${(fmt(r.avgDailyRetPct, 3) + '%').padStart(8)} · worst ${(fmt(r.maxDayLossPct, 1) + '%').padStart(7)} · best ${(fmt(r.maxDayGainPct, 1) + '%').padStart(6)} · maxDD ${fmt(r.maxEquityDD, 1)}%`,
  );
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const days = Number(process.argv[3] ?? 365);
  const fee = Number(process.argv[4] ?? 0.05);
  const lookback = Number(process.argv[5] ?? 20);

  const endMs = Date.now();
  const startMs = endMs - (days + lookback + 3) * DAY_MS;  // thêm đệm cho lookback
  console.log(`\nFetching ${symbol} ${INTERVAL} …`);
  const c = await fetchKlines(symbol, INTERVAL, startMs, endMs);
  console.log(`  ${c.length} nến (${new Date(c[0]!.t).toISOString().slice(0, 16)} → ${new Date(c[c.length - 1]!.t).toISOString().slice(0, 16)} UTC)`);
  const allDays = groupDays(c);
  // giữ lại ~days ngày cuối (đã có đệm lookback ở đầu)
  const grpDays = allDays.slice(-(days));
  console.log(`  ${grpDays.length} ngày (00:00 UTC → đóng bắt buộc 16:00 UTC = 23:00 UTC+7)`);

  console.log(`\n=== BTC INTRADAY DCA · ${symbol} · ${grpDays.length}d · fee ${fee}%/side · vốn $${CAPITAL} compound · lookback ${lookback}d · 5 mức DCA · KHÔNG stop-loss ===`);
  console.log(`  (levels = k × biên_độ_giảm_TB, chia đều 5 bậc dưới giá mở cửa ngày; mỗi bậc 1/5 vốn; đóng toàn bộ lúc 16:00 UTC)\n`);
  console.log(`${''.padEnd(34)} ${'net P&L'.padStart(11)} ${'return'.padStart(9)} | thống kê ngày`);
  console.log('  ' + '-'.repeat(150));

  printRow(benchOpenClose(grpDays, fee));

  const configs: Cfg[] = [
    { name: 'Adaptive k=0.50 (nông)', k: 0.50 },
    { name: 'Adaptive k=0.75', k: 0.75 },
    { name: 'Adaptive k=1.00 (=biên độ TB)', k: 1.00 },
    { name: 'Adaptive k=1.25 (sâu)', k: 1.25 },
    { name: 'Adaptive k=1.50 (rất sâu)', k: 1.50 },
    { name: 'Fixed -0.4/0.8/1.2/1.6/2.0%', k: 0, fixedLevels: [0.4, 0.8, 1.2, 1.6, 2.0] },
    { name: 'Fixed -0.5/1.0/1.5/2.0/2.5%', k: 0, fixedLevels: [0.5, 1.0, 1.5, 2.0, 2.5] },
    { name: 'Fixed -1.0/2.0/3.0/4.0/5.0%', k: 0, fixedLevels: [1.0, 2.0, 3.0, 4.0, 5.0] },
  ];
  for (const cfg of configs) printRow(run(grpDays, cfg, fee, lookback));

  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
