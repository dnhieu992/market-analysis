/**
 * BTC INTRADAY DCA — TP +1% (trước 8h) → chốt hoà (sau 8h) → đóng bắt buộc 16h UTC.
 *
 * Yêu cầu user:
 *   - Vào lệnh LONG lúc 00:00 UTC (lệnh 1 = market tại giá mở cửa ngày).
 *   - Chia 5 lần vào lệnh, mỗi lần cách nhau 2%: mức = dayOpen × (1 - {0,2,4,6,8}%).
 *     Lệnh 2..5 là limit, khớp khi low nến chạm mức. Mỗi lệnh = 1/5 vốn ngày.
 *   - Quản lý CẢ VỊ THẾ (gộp) theo giá hoà vốn trung bình (net phí):
 *       breakEvenPx = tổngChiPhí / (tổngQty × (1-fee)).
 *     • TRƯỚC 08:00 UTC: chốt LỜI ở +1% → thoát khi giá ≥ 1.01 × breakEvenPx.
 *     • TỪ 08:00 UTC trở đi: ưu tiên CHỐT HOÀ → thoát khi giá ≥ breakEvenPx.
 *   - ĐÓNG BẮT BUỘC lúc 16:00 UTC (tại open nến 16:00) nếu chưa thoát.
 *   - KHÔNG stop-loss. Vốn compound, tái sử dụng mỗi ngày (không giữ qua đêm).
 *
 * Backtest CHỈ từ 2023-01-01 UTC → nay.
 *
 * Quy ước mô phỏng trong 1 ngày (nến 15m, cửa sổ 00:00 → <16:00 UTC):
 *   - Trong mỗi nến: (1) khớp các mức limit chưa khớp nếu low ≤ mức (cập nhật giá hoà vốn),
 *     (2) kiểm tra thoát theo high. Nếu nến MỞ đã ≥ target → thoát tại open (gap-up), else nếu
 *     high ≥ target → thoát tại đúng target. Thoát 1 lần rồi ngừng (không vào lại trong ngày).
 *   - Chưa thoát tới 16:00 → đóng tại open nến 16:00 (forced).
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-intraday-dca-tp-be-backtest.ts [symbol] [feePctPerSide]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const INTERVAL = '15m';
const HOUR_MS = 36e5;
const CAPITAL = 1000;
const N_LEVELS = 5;

const START_UTC = Date.UTC(2023, 0, 1, 0, 0, 0, 0); // 2023-01-01
const DAY_START_HOUR = 0;   // 00:00 UTC
const FORCED_CLOSE_HOUR = 16; // 16:00 UTC
const BE_SWITCH_HOUR = 8;     // sau 08:00 UTC chuyển từ TP sang chốt hoà

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

// Mốc 00:00 UTC gần nhất <= t.
function dayStartMs(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAY_START_HOUR, 0, 0, 0);
}

type Day = { start: number; candles: Candle[]; open: number; closeCandle: Candle | null };

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
    const closeMs = start + FORCED_CLOSE_HOUR * HOUR_MS;
    const closeCandle = cands.find((x) => x.t === closeMs) ?? null;
    const win = cands.filter((x) => x.t >= start && x.t < closeMs);
    if (win.length === 0) continue;
    days.push({ start, candles: win, open: win[0]!.open, closeCandle });
  }
  return days;
}

type Cfg = { name: string; spacingPct: number; tpPct: number; beHour: number };
type Res = {
  name: string; finalEquity: number; retPct: number;
  tradedDays: number; winDays: number; avgFills: number;
  tpDays: number; beDays: number; forcedDays: number;
  worstDayPct: number; bestDayPct: number; maxEquityDD: number;
};

function run(days: Day[], cfg: Cfg, fee: number): Res {
  const f = fee / 100;
  let equity = CAPITAL;
  let equityPeak = CAPITAL, maxEquityDD = 0;
  let tradedDays = 0, winDays = 0, totalFills = 0;
  let tpDays = 0, beDays = 0, forcedDays = 0;
  let worst = 0, best = 0;

  for (const day of days) {
    if (!day.closeCandle) continue;
    const perLevel = equity / N_LEVELS;
    const entryPx: number[] = [];
    for (let i = 0; i < N_LEVELS; i++) entryPx.push(day.open * (1 - (i * cfg.spacingPct) / 100));
    const filled = new Array(N_LEVELS).fill(false);

    let qtyTotal = 0;   // tổng coin đang giữ (net phí mua)
    let costTotal = 0;  // tổng USD đã chi
    let closed = false;
    let exitPx = 0;
    let exitKind: 'tp' | 'be' | 'forced' = 'forced';

    for (const k of day.candles) {
      // (1) khớp các mức limit chưa khớp
      for (let li = 0; li < N_LEVELS; li++) {
        if (filled[li]) continue;
        if (k.low <= entryPx[li]!) {
          filled[li] = true;
          const q = (perLevel * (1 - f)) / entryPx[li]!;
          qtyTotal += q; costTotal += perLevel;
        }
      }
      if (qtyTotal <= 0) continue;

      // (2) kiểm tra thoát theo giá hoà vốn hiện tại
      const bePx = costTotal / (qtyTotal * (1 - f)); // giá thoát để net P&L = 0
      const hourFromStart = (k.t - day.start) / HOUR_MS;
      const useTp = hourFromStart < cfg.beHour;
      const target = useTp ? bePx * (1 + cfg.tpPct / 100) : bePx;
      if (k.open >= target) { closed = true; exitPx = k.open; exitKind = useTp ? 'tp' : 'be'; break; }
      if (k.high >= target) { closed = true; exitPx = target; exitKind = useTp ? 'tp' : 'be'; break; }
    }

    if (qtyTotal <= 0) { // không khớp gì cả ngày
      equityPeak = Math.max(equityPeak, equity);
      maxEquityDD = Math.max(maxEquityDD, (equityPeak - equity) / equityPeak);
      continue;
    }

    if (!closed) { exitPx = day.closeCandle.open; exitKind = 'forced'; }

    const proceeds = qtyTotal * exitPx * (1 - f); // phí bán
    const dayPnl = proceeds - costTotal;
    const dayRet = (dayPnl / costTotal) * 100; // trên vốn đã giải ngân

    tradedDays++; totalFills += filled.filter(Boolean).length;
    if (dayPnl > 0) winDays++;
    if (exitKind === 'tp') tpDays++; else if (exitKind === 'be') beDays++; else forcedDays++;
    worst = Math.min(worst, dayRet); best = Math.max(best, dayRet);
    equity += dayPnl;
    equityPeak = Math.max(equityPeak, equity);
    maxEquityDD = Math.max(maxEquityDD, (equityPeak - equity) / equityPeak);
  }

  return {
    name: cfg.name, finalEquity: equity, retPct: (equity / CAPITAL - 1) * 100,
    tradedDays, winDays, avgFills: tradedDays ? totalFills / tradedDays : 0,
    tpDays, beDays, forcedDays, worstDayPct: worst, bestDayPct: best, maxEquityDD: maxEquityDD * 100,
  };
}

// Benchmark: mỗi ngày mua toàn bộ tại 00:00 open, bán tại 16:00 open.
function benchOpenClose(days: Day[], fee: number): Res {
  const f = fee / 100;
  let equity = CAPITAL, peak = CAPITAL, dd = 0, win = 0, traded = 0, worst = 0, best = 0;
  for (const day of days) {
    if (!day.closeCandle) continue;
    const qty = (equity * (1 - f)) / day.open;
    const pnl = qty * day.closeCandle.open * (1 - f) - equity;
    const ret = (pnl / equity) * 100;
    equity += pnl; traded++; if (pnl > 0) win++;
    worst = Math.min(worst, ret); best = Math.max(best, ret);
    peak = Math.max(peak, equity); dd = Math.max(dd, (peak - equity) / peak);
  }
  return { name: 'Bench: buy 0h / sell 16h', finalEquity: equity, retPct: (equity / CAPITAL - 1) * 100, tradedDays: traded, winDays: win, avgFills: 1, tpDays: 0, beDays: 0, forcedDays: traded, worstDayPct: worst, bestDayPct: best, maxEquityDD: dd * 100 };
}

function printRow(r: Res) {
  const wr = r.tradedDays ? (r.winDays / r.tradedDays) * 100 : 0;
  console.log(
    `${r.name.padEnd(30)} ${usd(r.finalEquity - CAPITAL).padStart(11)} ${((r.retPct >= 0 ? '+' : '') + fmt(r.retPct, 1) + '%').padStart(9)} | ` +
    `days ${String(r.tradedDays).padStart(4)} · win ${(fmt(wr, 0) + '%').padStart(4)} · avgFill ${fmt(r.avgFills, 1)}/5 | ` +
    `TP ${String(r.tpDays).padStart(4)} · BE ${String(r.beDays).padStart(3)} · forced ${String(r.forcedDays).padStart(4)} | ` +
    `worst ${(fmt(r.worstDayPct, 1) + '%').padStart(8)} · best ${(fmt(r.bestDayPct, 1) + '%').padStart(6)} · maxDD ${fmt(r.maxEquityDD, 1)}%`,
  );
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const fee = Number(process.argv[3] ?? 0.05);

  const endMs = Date.now();
  console.log(`\nFetching ${symbol} ${INTERVAL} từ ${new Date(START_UTC).toISOString().slice(0, 10)} …`);
  const c = await fetchKlines(symbol, INTERVAL, START_UTC, endMs);
  console.log(`  ${c.length} nến (${new Date(c[0]!.t).toISOString().slice(0, 16)} → ${new Date(c[c.length - 1]!.t).toISOString().slice(0, 16)} UTC)`);
  const grpDays = groupDays(c);
  console.log(`  ${grpDays.length} ngày (cửa sổ 00:00 → đóng bắt buộc 16:00 UTC)`);

  console.log(`\n=== BTC INTRADAY DCA · TP/BE/forced · ${symbol} · ${grpDays.length}d · fee ${fee}%/side · vốn $${CAPITAL} compound · 5 mức · KHÔNG SL ===`);
  console.log(`  Luật user: 5 mức cách 2% (0/-2/-4/-6/-8%) · TRƯỚC 8h chốt +1% · TỪ 8h chốt hoà · đóng bắt buộc 16h\n`);
  console.log(`${''.padEnd(30)} ${'net P&L'.padStart(11)} ${'return'.padStart(9)} | thống kê`);
  console.log('  ' + '-'.repeat(150));

  printRow(benchOpenClose(grpDays, fee));

  const configs: Cfg[] = [
    { name: '★ User: 2% · TP1% · BE@8h', spacingPct: 2, tpPct: 1, beHour: 8 },
    // sensitivity
    { name: 'spacing 1% · TP1% · BE@8h', spacingPct: 1, tpPct: 1, beHour: 8 },
    { name: 'spacing 3% · TP1% · BE@8h', spacingPct: 3, tpPct: 1, beHour: 8 },
    { name: '2% · TP1% · BE@4h (sớm)', spacingPct: 2, tpPct: 1, beHour: 4 },
    { name: '2% · TP1% · BE@12h (muộn)', spacingPct: 2, tpPct: 1, beHour: 12 },
    { name: '2% · TP1% · no-BE(TP tới 16h)', spacingPct: 2, tpPct: 1, beHour: 16 },
    { name: '2% · TP2% · BE@8h', spacingPct: 2, tpPct: 2, beHour: 8 },
    { name: '2% · TP0.5% · BE@8h', spacingPct: 2, tpPct: 0.5, beHour: 8 },
  ];
  for (const cfg of configs) printRow(run(grpDays, cfg, fee));
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
