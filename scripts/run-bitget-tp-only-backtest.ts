/**
 * /bitget — "chốt lời thôi, không stop-loss" scan.
 *
 * Đo mọi entry rule mà trang /bitget THỰC SỰ có sẵn (cột QQE, cột H4/Hôm nay/7-30 ngày, các
 * indicator vẽ trên Setup chart: UT Bot 10/3, EMA200, RSI14) với một luật thoát duy nhất:
 * **TP cố định +x%, không SL, không giới hạn thời gian**.
 *
 * Vì sao phải in nhiều cột: khi bỏ SL và giữ vô hạn, HIT RATE tự tiến về 100% — nó không nói lên
 * gì cả. Cái quyết định tiền là (a) vốn bị khoá bao lâu và (b) lệnh xấu nhất âm bao sâu. Nên mỗi
 * mức TP đều báo kèm: số ngày tới TP, MAE, **lợi nhuận trên mỗi năm-vốn bị khoá**, và equity
 * compound thật của một ví chạy tuần tự.
 *
 * Entry model = market order tại CLOSE nến H4 (đúng cái /bitget làm được: openMarketPosition).
 * Exit model  = TP đặt sẵn trên sàn (placePositionTpsl) → khớp intra-candle khi high chạm.
 *
 * PHẦN B: lot-grid (mua khi giảm X% so với đỉnh chạy kể từ lần mua cuối, mỗi lô bán riêng ở +Y%),
 * mô hình `close` — tức chỉ kiểm tra 1 lần mỗi nến H4, đúng cái một cron + market order làm được.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-bitget-tp-only-backtest.ts [startYYYY-MM-DD] [feePctPerSide] [interval]
 */
import * as https from 'https';
import { calculateQqe, calcUtBotSignals } from '@app/core';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

// đúng tham số chart /bitget (QQE_PARAMS + UT_BOT_PARAMS trong setup-chart-renderer.ts)
const QQE = { rsiPeriod: 10, smoothing: 4, qqeFactor: 3.2 } as const;
const UTBOT = { atrPeriod: 10, keyValue: 3 } as const;

// PINNED + WATCHLIST của Setup tab (bitget-setup-feed.tsx)
const UNIVERSE = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BCHUSDT',
  'AVAXUSDT', 'AAVEUSDT', 'FILUSDT', 'ONDOUSDT', 'TIAUSDT', 'WLDUSDT',
];

const TP_LEVELS = [1, 2, 3, 5, 10];

type Candle = { openTime: number; open: number; high: number; low: number; close: number };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function fetchKlines(symbol: string, interval: string, startMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = startMs;
  const end = Date.now();
  for (;;) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${end}&limit=${MAX_PER_REQ}`;
    let rows: unknown[];
    try {
      rows = await fetchJson(url);
    } catch {
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows as any[]) {
      out.push({
        openTime: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
      });
    }
    if (rows.length < MAX_PER_REQ) break;
    cursor = Number((rows[rows.length - 1] as any)[0]) + 1;
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

/** EMA series aligned to values (NaN trước warm-up). */
function emaSeries(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let ema = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (i + 1 < period) continue;
    if (Number.isNaN(ema)) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += values[j]!;
      ema = s / period;
    } else {
      ema = v * k + ema * (1 - k);
    }
    out[i] = ema;
  }
  return out;
}

/** Wilder RSI series aligned to closes. */
function rsiSeries(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) g += d;
    else l -= d;
  }
  g /= period;
  l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) {
      g = (g * (period - 1) + d) / period;
      l = (l * (period - 1)) / period;
    } else {
      g = (g * (period - 1)) / period;
      l = (l * (period - 1) - d) / period;
    }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

// ---------------------------------------------------------------- entry rules

type RuleName =
  | 'clock00'      // luật auto-trade hiện tại: long lúc 00:00 UTC mỗi ngày
  | 'qqe'          // cột QQE của Setup tab: mũi tên ▲ trên H4
  | 'qqeRsi45'     // ▲ + RSI14 < 45 (chỉ lấy mũi tên ở vùng thấp)
  | 'dipH4_3'      // cột "H4" đỏ ≥ 3%: nến H4 vừa đóng giảm ≥ 3%
  | 'dip24h_8'     // 6 nến H4 (~1 ngày) giảm ≥ 8%
  | 'utFlip'       // UT Bot 10/3 lật xanh trên H4
  | 'ema200Rsi30'; // giá dưới EMA200 H4 và RSI14 < 30

const RULES: RuleName[] = ['clock00', 'qqe', 'qqeRsi45', 'dipH4_3', 'dip24h_8', 'utFlip', 'ema200Rsi30'];

/** true tại index i nghĩa là: nến i vừa đóng và rule cho phép vào lệnh tại close của nến i. */
function buildSignals(candles: Candle[], rule: RuleName, barMs: number): boolean[] {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const sig = new Array<boolean>(n).fill(false);

  if (rule === 'clock00') {
    // nến H4 KẾT THÚC lúc 00:00 UTC → vào lệnh ở đúng thời điểm engine auto-trade chạy
    for (let i = 0; i < n; i++) {
      const closeTime = candles[i]!.openTime + barMs;
      if (closeTime % 86_400_000 === 0) sig[i] = true;
    }
    return sig;
  }

  if (rule === 'qqe' || rule === 'qqeRsi45') {
    const q = calculateQqe(closes, QQE.rsiPeriod, QQE.smoothing, QQE.qqeFactor);
    const rsi = rsiSeries(closes, 14);
    for (let i = 0; i < n; i++) {
      if (q.cross[i] !== 'long') continue;
      if (rule === 'qqeRsi45' && !(rsi[i]! < 45)) continue;
      sig[i] = true;
    }
    return sig;
  }

  if (rule === 'dipH4_3') {
    for (let i = 0; i < n; i++) {
      const c = candles[i]!;
      if ((c.close - c.open) / c.open <= -0.03) sig[i] = true;
    }
    return sig;
  }

  if (rule === 'dip24h_8') {
    for (let i = 6; i < n; i++) {
      if ((closes[i]! - closes[i - 6]!) / closes[i - 6]! <= -0.08) sig[i] = true;
    }
    return sig;
  }

  if (rule === 'utFlip') {
    const ut = calcUtBotSignals(
      candles.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close })),
      UTBOT.atrPeriod,
      UTBOT.keyValue
    );
    for (let i = 0; i < n; i++) if (ut[i]!.buySignal) sig[i] = true;
    return sig;
  }

  // ema200Rsi30
  const ema200 = emaSeries(closes, 200);
  const rsi = rsiSeries(closes, 14);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(ema200[i]!) || !Number.isFinite(rsi[i]!)) continue;
    if (closes[i]! < ema200[i]! && rsi[i]! < 30) sig[i] = true;
  }
  return sig;
}

// ------------------------------------------------------- PHẦN A: TP-only scan

type IndepStat = {
  n: number;
  hits: number;
  matureN: number;
  matureHits: number;
  daysToTp: number[];
  maes: number[];        // MAE của lệnh đã chạm TP (%)
  openMae: number[];     // MAE của lệnh CHƯA chạm TP (%)
  openDays: number[];    // vốn bị treo bao lâu (ngày) của lệnh chưa chạm
  gain: number;          // tổng lãi ròng (đơn vị: bội số vốn 1 lệnh)
  yearsHeld: number;     // tổng năm-vốn bị chiếm
};

/** Mỗi tín hiệu = 1 lệnh độc lập (đo chất lượng thô của signal, cho phép trùng lệnh). */
function scanIndependent(
  candles: Candle[],
  sig: boolean[],
  tpPct: number,
  feePct: number,
  barMs: number,
  matureDays = 180
): IndepStat {
  const st: IndepStat = {
    n: 0, hits: 0, matureN: 0, matureHits: 0,
    daysToTp: [], maes: [], openMae: [], openDays: [], gain: 0, yearsHeld: 0,
  };
  const f = feePct / 100;
  const tp = tpPct / 100;
  const n = candles.length;
  const lastTime = candles[n - 1]!.openTime;
  const matureMs = matureDays * 86_400_000;

  for (let i = 0; i < n; i++) {
    if (!sig[i]) continue;
    const entry = candles[i]!.close;
    const target = entry * (1 + tp);
    const mature = lastTime - candles[i]!.openTime >= matureMs;
    st.n++;
    if (mature) st.matureN++;

    let mae = 0;
    let hit = -1;
    for (let j = i + 1; j < n; j++) {
      const c = candles[j]!;
      const dd = (c.low - entry) / entry;
      if (dd < mae) mae = dd;
      if (c.high >= target) { hit = j; break; }
    }
    if (hit >= 0) {
      st.hits++;
      if (mature) st.matureHits++;
      const days = ((candles[hit]!.openTime - candles[i]!.openTime) / 86_400_000);
      st.daysToTp.push(days);
      st.maes.push(mae * 100);
      st.gain += (1 - f) * (1 + tp) * (1 - f) - 1;
      st.yearsHeld += Math.max(days, barMs / 86_400_000) / 365;
    } else {
      const last = candles[n - 1]!.close;
      const days = (candles[n - 1]!.openTime - candles[i]!.openTime) / 86_400_000;
      st.openMae.push(mae * 100);
      st.openDays.push(days);
      st.gain += (1 - f) * (last / entry) * (1 - f) - 1; // mark-to-market
      st.yearsHeld += Math.max(days, barMs / 86_400_000) / 365;
    }
  }
  return st;
}

type SeqResult = {
  trades: number;
  finalEquity: number;
  cagr: number;
  maxDd: number;
  pctTimeInMarket: number;
  stillOpenDays: number;
};

/** Một ví thật: mỗi lúc 1 vị thế, all-in compound, tín hiệu khi đang giữ thì bỏ qua. */
function runSequential(
  candles: Candle[],
  sig: boolean[],
  tpPct: number,
  feePct: number,
  capital = 1000
): SeqResult {
  const f = feePct / 100;
  const tp = tpPct / 100;
  const n = candles.length;
  let cash = capital;
  let units = 0;
  let entryPx = 0;
  let barsIn = 0;
  let trades = 0;
  let peak = capital;
  let maxDd = 0;
  let openSince = -1;

  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    if (units > 0) {
      barsIn++;
      const target = entryPx * (1 + tp);
      if (c.high >= target) {
        cash = units * target * (1 - f);
        units = 0;
        openSince = -1;
      }
    }
    if (units === 0 && sig[i]) {
      units = (cash * (1 - f)) / c.close;
      entryPx = c.close;
      cash = 0;
      trades++;
      openSince = i;
    }
    const eq = cash + units * c.close;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const last = candles[n - 1]!;
  const finalEquity = cash + units * last.close;
  const years = (last.openTime - candles[0]!.openTime) / (365 * 86_400_000);
  return {
    trades,
    finalEquity,
    cagr: years > 0 ? (Math.pow(finalEquity / capital, 1 / years) - 1) * 100 : 0,
    maxDd: maxDd * 100,
    pctTimeInMarket: (barsIn / n) * 100,
    stillOpenDays: openSince >= 0 ? (last.openTime - candles[openSince]!.openTime) / 86_400_000 : 0,
  };
}

// -------------------------------------------------- PHẦN B: lot-grid (close model)

type GridResult = {
  finalEquity: number;
  cagr: number;
  maxDd: number;
  buys: number;
  sells: number;
  openLots: number;
  worstStuckDays: number;
  avgLotsHeld: number;
};

function runLotGrid(
  candles: Candle[],
  dropPct: number,
  tpPct: number,
  maxLots: number,
  feePct: number,
  capital = 1000
): GridResult {
  const f = feePct / 100;
  const drop = dropPct / 100;
  const tp = tpPct / 100;
  const lotSize = capital / maxLots;
  let cash = capital;
  const lots: { px: number; units: number; at: number }[] = [];
  let ref = candles[0]!.close;
  let buys = 0;
  let sells = 0;
  let peak = capital;
  let maxDd = 0;
  let lotBarSum = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    // 1. bán trước: lô nào có target ≤ close (mô hình close, không dùng high)
    for (let k = lots.length - 1; k >= 0; k--) {
      const lot = lots[k]!;
      if (lot.at === i) continue; // lô mua nến này không bán ngay nến này
      if (c.close >= lot.px * (1 + tp)) {
        cash += lot.units * c.close * (1 - f);
        lots.splice(k, 1);
        sells++;
      }
    }
    // 2. mua: tối đa 1 lô/nến (một lần check = một market order)
    if (c.close > ref) ref = c.close;
    if (c.close <= ref * (1 - drop) && lots.length < maxLots && cash >= lotSize) {
      const units = (lotSize * (1 - f)) / c.close;
      lots.push({ px: c.close, units, at: i });
      cash -= lotSize;
      ref = c.close;
      buys++;
    }
    lotBarSum += lots.length;
    const eq = cash + lots.reduce((s, l) => s + l.units * c.close, 0);
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const last = candles[candles.length - 1]!;
  const finalEquity = cash + lots.reduce((s, l) => s + l.units * last.close, 0);
  const years = (last.openTime - candles[0]!.openTime) / (365 * 86_400_000);
  const worstStuck = lots.length
    ? Math.max(...lots.map((l) => (last.openTime - candles[l.at]!.openTime) / 86_400_000))
    : 0;
  return {
    finalEquity,
    cagr: years > 0 ? (Math.pow(finalEquity / capital, 1 / years) - 1) * 100 : 0,
    maxDd: maxDd * 100,
    buys,
    sells,
    openLots: lots.length,
    worstStuckDays: worstStuck,
    avgLotsHeld: lotBarSum / candles.length,
  };
}

// ---------------------------------------------------------------------- utils

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)));
  return s[idx]!;
}
const med = (a: number[]) => pct(a, 50);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');

// ----------------------------------------------------------------------- main

async function main() {
  const startArg = process.argv[2] ?? '2023-01-01';
  const feePct = Number(process.argv[3] ?? 0.06);
  const interval = process.argv[4] ?? '4h';
  const barMs = interval === '4h' ? 4 * 3600_000 : interval === '1h' ? 3600_000 : 86_400_000;
  const startMs = new Date(`${startArg}T00:00:00Z`).getTime();

  console.log(`\n=== /bitget TP-ONLY (không SL) — ${interval}, từ ${startArg}, fee ${feePct}%/side ===\n`);

  const data = new Map<string, Candle[]>();
  for (const sym of UNIVERSE) {
    const c = await fetchKlines(sym, interval, startMs);
    if (c.length < 400) {
      console.log(`  ${sym}: bỏ qua (chỉ ${c.length} nến)`);
      continue;
    }
    data.set(sym, c);
    const from = new Date(c[0]!.openTime).toISOString().slice(0, 10);
    const to = new Date(c[c.length - 1]!.openTime).toISOString().slice(0, 10);
    const bh = ((c[c.length - 1]!.close / c[0]!.close) - 1) * 100;
    console.log(`  ${sym.padEnd(9)} ${c.length} nến  ${from} → ${to}   B&H ${f1(bh)}%`);
  }

  // ---------------- PHẦN A1: chất lượng tín hiệu (independent, gộp mọi coin)
  console.log(`\n\n### A1. Chất lượng tín hiệu — mỗi ▲ là 1 lệnh riêng, gộp ${data.size} coin`);
  console.log('(hit% = matured-only, tức chỉ tín hiệu đã có ≥180 ngày dữ liệu phía trước)\n');
  console.log(
    'rule'.padEnd(13) + 'TP'.padStart(4) + 'n'.padStart(7) + 'hit%'.padStart(7) +
    'ngày→TP med/p90'.padStart(17) + 'MAE med/p10'.padStart(14) +
    'kẹt: n / ngày max / MAE'.padStart(26) + '%/năm-vốn'.padStart(11)
  );
  console.log('-'.repeat(99));

  const bestByRule = new Map<string, { tp: number; perYear: number }>();
  for (const rule of RULES) {
    for (const tp of TP_LEVELS) {
      const agg: IndepStat = {
        n: 0, hits: 0, matureN: 0, matureHits: 0,
        daysToTp: [], maes: [], openMae: [], openDays: [], gain: 0, yearsHeld: 0,
      };
      for (const [, candles] of data) {
        const sig = buildSignals(candles, rule, barMs);
        const st = scanIndependent(candles, sig, tp, feePct, barMs);
        agg.n += st.n; agg.hits += st.hits;
        agg.matureN += st.matureN; agg.matureHits += st.matureHits;
        agg.daysToTp.push(...st.daysToTp);
        agg.maes.push(...st.maes);
        agg.openMae.push(...st.openMae);
        agg.openDays.push(...st.openDays);
        agg.gain += st.gain; agg.yearsHeld += st.yearsHeld;
      }
      const perYear = agg.yearsHeld > 0 ? (agg.gain / agg.yearsHeld) * 100 : NaN;
      const prev = bestByRule.get(rule);
      if (!prev || perYear > prev.perYear) bestByRule.set(rule, { tp, perYear });
      console.log(
        rule.padEnd(13) +
        `${tp}%`.padStart(4) +
        String(agg.n).padStart(7) +
        (agg.matureN ? f1((agg.matureHits / agg.matureN) * 100) : '—').padStart(7) +
        `${f1(med(agg.daysToTp))}/${f1(pct(agg.daysToTp, 90))}`.padStart(17) +
        `${f1(med(agg.maes))}/${f1(pct(agg.maes, 10))}`.padStart(14) +
        `${agg.openDays.length} / ${f1(Math.max(0, ...agg.openDays))} / ${f1(med(agg.openMae))}`.padStart(26) +
        f1(perYear).padStart(11)
      );
    }
    console.log('-'.repeat(99));
  }

  // ---------------- PHẦN A2: ví thật (sequential, compound) — TP tốt nhất mỗi rule
  console.log(`\n\n### A2. Một ví thật — 1 vị thế/lúc, all-in compound $1000, so với B&H\n`);
  console.log(
    'rule'.padEnd(13) + 'TP'.padStart(4) + '| ' +
    UNIVERSE.filter((s) => data.has(s)).map((s) => s.replace('USDT', '').padStart(7)).join('') +
    '  | CAGR tb'.padStart(10) + 'DD tb'.padStart(8) + '%thời gian'.padStart(11)
  );
  const bhLine =
    'BUY & HOLD'.padEnd(13) + '—'.padStart(4) + '| ' +
    [...data.entries()].map(([, c]) => f1(((c[c.length - 1]!.close / c[0]!.close) - 1) * 100).padStart(7)).join('');
  console.log('-'.repeat(120));
  console.log(bhLine + '   (tổng %)');
  console.log('-'.repeat(120));

  for (const rule of RULES) {
    for (const tp of TP_LEVELS) {
      const cells: string[] = [];
      const cagrs: number[] = [];
      const dds: number[] = [];
      const tims: number[] = [];
      for (const [, candles] of data) {
        const sig = buildSignals(candles, rule, barMs);
        const r = runSequential(candles, sig, tp, feePct);
        cells.push(f1(((r.finalEquity / 1000) - 1) * 100).padStart(7));
        cagrs.push(r.cagr); dds.push(r.maxDd); tims.push(r.pctTimeInMarket);
      }
      const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
      console.log(
        rule.padEnd(13) + `${tp}%`.padStart(4) + '| ' + cells.join('') +
        f1(avg(cagrs)).padStart(10) + f1(avg(dds)).padStart(8) + f1(avg(tims)).padStart(11)
      );
    }
    console.log('-'.repeat(120));
  }

  // ---------------- PHẦN B: lot grid
  console.log(`\n\n### B. Lot-grid TP-only — mua khi giảm X% từ đỉnh chạy, mỗi lô bán riêng ở +Y%`);
  console.log('(mô hình `close`: 1 lần check mỗi nến H4 = 1 market order — đúng cái /bitget làm được)\n');
  const gridConfigs: [number, number, number][] = [
    [3, 5, 20], [3, 5, 10], [5, 7, 20], [5, 10, 20], [5, 10, 10], [7, 10, 20], [10, 15, 10],
  ];
  console.log(
    'X/Y/lô'.padEnd(11) + '| ' +
    UNIVERSE.filter((s) => data.has(s)).map((s) => s.replace('USDT', '').padStart(7)).join('') +
    '  |CAGR tb'.padStart(9) + 'DD tb'.padStart(7) + 'lô tb'.padStart(7) + 'kẹt ngày'.padStart(10)
  );
  console.log('-'.repeat(120));
  for (const [x, y, lots] of gridConfigs) {
    const cells: string[] = [];
    const cagrs: number[] = [];
    const dds: number[] = [];
    const held: number[] = [];
    const stuck: number[] = [];
    for (const [, candles] of data) {
      const r = runLotGrid(candles, x, y, lots, feePct);
      cells.push(f1(((r.finalEquity / 1000) - 1) * 100).padStart(7));
      cagrs.push(r.cagr); dds.push(r.maxDd); held.push(r.avgLotsHeld); stuck.push(r.worstStuckDays);
    }
    const avg = (a: number[]) => a.reduce((s, x2) => s + x2, 0) / a.length;
    console.log(
      `${x}/${y}/${lots}`.padEnd(11) + '| ' + cells.join('') +
      f1(avg(cagrs)).padStart(9) + f1(avg(dds)).padStart(7) +
      f2(avg(held)).padStart(7) + f1(Math.max(...stuck)).padStart(10)
    );
  }
  console.log('-'.repeat(120));
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
