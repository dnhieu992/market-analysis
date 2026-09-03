/**
 * "Compression breakout" — chiến lược rút ra từ cú nổ BTC 19-21/08/2026.
 *
 * Quan sát gốc (scan 2026-09-03):
 *   - BTC đi ngang 10 tuần trong biên ~8%, biên độ ngày co về 0.4-2%.
 *   - Volume cạn còn 0.38x trung bình 20 ngày ngay trước khi nổ.
 *   - Nến phá lên đi kèm volume 2.7x -> 4.0x.
 *   - Cả thị trường lấy lại EMA200 D1 trong cùng 5 ngày.
 *
 * Luật vào lệnh (long-only spot, quyết định trên nến D1 ĐÃ ĐÓNG, vào tại close):
 *   1. NÉN     : (maxHigh - minLow) của N nến gần nhất <= maxRangePct  -> biên độ hẹp
 *   2. CẠN VOL : volume trung bình dryDays nến gần nhất <= dryMult x trung bình 20 ngày (0 = tắt)
 *   3. PHÁ     : close > maxHigh của N nến TRƯỚC đó (không tính nến hiện tại)
 *   4. VOL NỔ  : volume nến phá >= volMult x trung bình 20 ngày (0 = tắt)
 *   5. LỌC E200: tuỳ chọn — chỉ vào khi close > EMA200, hoặc bỏ qua
 *
 * Thoát lệnh (chọn 1 trong 4, để so sánh):
 *   utbot   — UTBot D1 (ATR10, kv) lật sang bear trên close   [thoát gốc của repo]
 *   chandel — trailing stop chandelier: đỉnh cao nhất kể từ khi vào - atrMult x ATR14
 *   tpsl    — TP +tpPct% / SL -slPct% (kiểm tra intra-candle, SL ưu tiên)
 *   ema20   — close thủng xuống dưới EMA20
 *
 * Phí 0.05%/side (0.1%/vòng), vốn $1000 compound, không đòn bẩy, không slippage.
 * Benchmark: buy & hold cùng kỳ.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-compression-breakout-backtest.ts [symbol] [startYear] [feePctPerSide] [mode]
 *   mode: sweep (mặc định) | detail
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { open: number; high: number; low: number; close: number; vol: number; openTime: Date };

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
        vol: parseFloat(k[7] as string), // quote volume
        openTime: new Date(k[0] as number),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

function ema(v: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const out: number[] = [];
  let e = v[0]!;
  for (let i = 0; i < v.length; i++) {
    e = i === 0 ? v[0]! : v[i]! * k + e * (1 - k);
    out.push(e);
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
function utBotTrend(c: Candle[], period: number, keyValue: number): ('bull' | 'bear' | null)[] {
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
  return c.map((x, i) => (i < period || stop[i] === 0 ? null : x.close > stop[i]! ? 'bull' : 'bear'));
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const fmtUsd = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });

type ExitMode = 'utbot' | 'chandel' | 'tpsl' | 'ema20';

type Cfg = {
  n: number;            // compression window
  maxRangePct: number;  // squeeze threshold
  dryMult: number;      // 0 = off
  dryDays: number;
  dryMode: 'avg' | 'min'; // avg = trung bình dryDays ngày; min = ngày thấp nhất trong dryDays ngày
  volMult: number;      // 0 = off
  e200: 'off' | 'above';
  exit: ExitMode;
  kv: number;
  atrMult: number;
  tpPct: number;
  slPct: number;
};

type Trade = { entryDate: Date; exitDate: Date; entry: number; exit: number; netPct: number; bars: number; reason: string };

type Result = {
  trades: Trade[];
  equity: number;
  retPct: number;
  maxDdPct: number;
  exposurePct: number;
  winPct: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  /** Vốn kỳ vọng nếu nắm ĐÚNG số ngày đó nhưng vào thời điểm ngẫu nhiên. */
  randomEquiv: number;
  /** Strategy equity / randomEquiv - 1. >0 = việc chọn thời điểm có giá trị thật. */
  edgePct: number;
};

function simulate(c: Candle[], startIdx: number, cfg: Cfg, capital: number, feePerSide: number): Result {
  const cl = c.map((x) => x.close);
  const e20 = ema(cl, 20);
  const e200 = ema(cl, 200);
  const atr = wilderAtr(c, 14);
  const trend = utBotTrend(c, 10, cfg.kv);
  const fee = feePerSide / 100;

  const avgVol = (i: number, len: number) => {
    let s = 0;
    for (let j = i - len; j < i; j++) s += c[j]!.vol;
    return s / len;
  };

  const trades: Trade[] = [];
  let equity = capital;
  let peakEquity = capital;
  let maxDd = 0;
  let barsIn = 0;
  let barsTotal = 0;

  let pos: { entry: number; entryIdx: number; peak: number } | null = null;

  for (let i = Math.max(startIdx, 220); i < c.length; i++) {
    barsTotal++;
    const bar = c[i]!;

    // ---- manage an open position first (exit checked on this bar)
    if (pos) {
      barsIn++;
      pos.peak = Math.max(pos.peak, bar.high);
      let exitPrice: number | null = null;
      let reason = '';

      if (cfg.exit === 'tpsl') {
        const sl = pos.entry * (1 - cfg.slPct / 100);
        const tp = pos.entry * (1 + cfg.tpPct / 100);
        if (bar.low <= sl) {
          exitPrice = sl; // pessimistic: SL first when both touched in one candle
          reason = 'SL';
        } else if (bar.high >= tp) {
          exitPrice = tp;
          reason = 'TP';
        }
      } else if (cfg.exit === 'chandel') {
        const stop = pos.peak - cfg.atrMult * atr[i]!;
        if (bar.close < stop) {
          exitPrice = bar.close;
          reason = 'trail';
        }
      } else if (cfg.exit === 'ema20') {
        if (bar.close < e20[i]!) {
          exitPrice = bar.close;
          reason = 'ema20';
        }
      } else {
        if (trend[i] === 'bear') {
          exitPrice = bar.close;
          reason = 'utbot';
        }
      }

      if (exitPrice !== null) {
        const net = (exitPrice - pos.entry) / pos.entry - 2 * fee;
        equity *= 1 + net;
        trades.push({
          entryDate: c[pos.entryIdx]!.openTime,
          exitDate: bar.openTime,
          entry: pos.entry,
          exit: exitPrice,
          netPct: net * 100,
          bars: i - pos.entryIdx,
          reason,
        });
        pos = null;
        peakEquity = Math.max(peakEquity, equity);
        maxDd = Math.max(maxDd, (peakEquity - equity) / peakEquity);
      } else {
        // mark-to-market drawdown while holding
        const mtm = equity * (1 + ((bar.close - pos.entry) / pos.entry - 2 * fee));
        peakEquity = Math.max(peakEquity, mtm);
        maxDd = Math.max(maxDd, (peakEquity - mtm) / peakEquity);
      }
    }

    if (pos) continue; // no pyramiding

    // ---- entry check on the closed bar
    // 1. compression over the N bars BEFORE this one
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - cfg.n; j < i; j++) {
      hi = Math.max(hi, c[j]!.high);
      lo = Math.min(lo, c[j]!.low);
    }
    const rangePct = ((hi - lo) / lo) * 100;
    if (rangePct > cfg.maxRangePct) continue;

    // 2. volume dry-up before the break
    if (cfg.dryMult > 0) {
      const ref = cfg.dryMult * avgVol(i, 20);
      if (cfg.dryMode === 'min') {
        // ngày volume thấp nhất trong cửa sổ phải cạn (đúng với cái quan sát 16/08: 0.38x một ngày)
        let lowest = Infinity;
        for (let j = i - cfg.dryDays; j < i; j++) lowest = Math.min(lowest, c[j]!.vol);
        if (lowest > ref) continue;
      } else {
        let s = 0;
        for (let j = i - cfg.dryDays; j < i; j++) s += c[j]!.vol;
        if (s / cfg.dryDays > ref) continue;
      }
    }

    // 3. break of the compression high
    if (bar.close <= hi) continue;

    // 4. volume expansion on the break bar
    if (cfg.volMult > 0 && bar.vol < cfg.volMult * avgVol(i, 20)) continue;

    // 5. EMA200 filter
    if (cfg.e200 === 'above' && bar.close <= e200[i]!) continue;

    pos = { entry: bar.close, entryIdx: i, peak: bar.high };
  }

  // mark the final open position to market
  if (pos) {
    const last = c[c.length - 1]!;
    const net = (last.close - pos.entry) / pos.entry - 2 * fee;
    equity *= 1 + net;
    trades.push({
      entryDate: c[pos.entryIdx]!.openTime,
      exitDate: last.openTime,
      entry: pos.entry,
      exit: last.close,
      netPct: net * 100,
      bars: c.length - 1 - pos.entryIdx,
      reason: 'open',
    });
  }

  const wins = trades.filter((t) => t.netPct > 0);
  const losses = trades.filter((t) => t.netPct <= 0);
  const grossWin = wins.reduce((s, t) => s + t.netPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPct, 0));

  // Benchmark đúng: nắm cùng SỐ NGÀY nhưng vào ngẫu nhiên.
  // avgDaily = lợi nhuận ngày trung bình hình học của toàn bộ giai đoạn scan.
  const firstC = c[Math.max(startIdx, 220)]!.close;
  const lastC = c[c.length - 1]!.close;
  const nBars = c.length - 1 - Math.max(startIdx, 220);
  const avgDaily = nBars > 0 ? Math.pow(lastC / firstC, 1 / nBars) - 1 : 0;
  const randomEquiv = capital * Math.pow(1 + avgDaily, barsIn);

  return {
    trades,
    equity,
    randomEquiv,
    edgePct: randomEquiv > 0 ? (equity / randomEquiv - 1) * 100 : 0,
    retPct: ((equity - capital) / capital) * 100,
    maxDdPct: maxDd * 100,
    exposurePct: barsTotal > 0 ? (barsIn / barsTotal) * 100 : 0,
    winPct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
  };
}

function label(cfg: Cfg): string {
  const parts = [
    `N${cfg.n}`,
    `rng<=${cfg.maxRangePct}%`,
    cfg.dryMult > 0 ? `dry-${cfg.dryMode}${cfg.dryMult}x/${cfg.dryDays}d` : 'dry-off',
    cfg.volMult > 0 ? `vol>=${cfg.volMult}x` : 'vol-off',
    cfg.e200 === 'above' ? 'E200+' : 'E200-off',
    cfg.exit === 'tpsl' ? `tp${cfg.tpPct}/sl${cfg.slPct}` : cfg.exit === 'chandel' ? `chand${cfg.atrMult}` : cfg.exit === 'utbot' ? `utbot kv${cfg.kv}` : 'ema20',
  ];
  return parts.join(' ');
}

function header(): void {
  console.log(
    'config'.padEnd(58) + '  trades  win%   net equity   return%    maxDD   expo%    PF   rand-hold   EDGE',
  );
}

function printRow(cfg: Cfg, r: Result): void {
  console.log(
    label(cfg).padEnd(58) +
      `  ${String(r.trades.length).padStart(6)}  ${r.winPct.toFixed(0).padStart(3)}%  ` +
      `${fmtUsd(r.equity).padStart(11)}  ${r.retPct.toFixed(1).padStart(8)}%  ${r.maxDdPct.toFixed(1).padStart(6)}%  ` +
      `${r.exposurePct.toFixed(0).padStart(5)}%  ${(r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)).padStart(5)}  ` +
      `${fmtUsd(r.randomEquiv).padStart(9)}  ${(r.edgePct >= 0 ? '+' : '') + r.edgePct.toFixed(0)}%`,
  );
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const startYear = parseInt(process.argv[3] ?? '2020', 10);
  const feePerSide = parseFloat(process.argv[4] ?? '0.05');
  const mode = process.argv[5] ?? 'sweep';
  const endYear = parseInt(process.argv[6] ?? '0', 10); // 0 = tới hiện tại
  const capital = 1000;

  const endMs = endYear > 0 ? Date.UTC(endYear + 1, 0, 1) : Date.now();
  const all = (await fetchKlines(symbol, '1d', Date.UTC(startYear - 2, 0, 1), Date.now())).filter(
    (c) => c.openTime.getTime() < endMs,
  );
  const scanStart = Date.UTC(startYear, 0, 1);
  const startIdx = all.findIndex((c) => c.openTime.getTime() >= scanStart);

  const first = all[startIdx]!;
  const last = all[all.length - 1]!;
  const bh = ((last.close - first.close) / first.close) * 100;

  console.log(`${symbol} 1d  |  ${fmtDate(first.openTime)} -> ${fmtDate(last.openTime)}  (${all.length - startIdx} candles)`);
  console.log(`Capital $${capital} compounded, fee ${feePerSide}%/side, long-only spot, no pyramiding`);
  // max drawdown của buy & hold trên cùng giai đoạn, để so sánh rủi ro cho công bằng
  let bhPeak = -Infinity;
  let bhDd = 0;
  for (let i = startIdx; i < all.length; i++) {
    bhPeak = Math.max(bhPeak, all[i]!.close);
    bhDd = Math.max(bhDd, (bhPeak - all[i]!.low) / bhPeak);
  }
  console.log(
    `Buy & hold benchmark: ${fmtUsd(first.close)} -> ${fmtUsd(last.close)} = ${bh >= 0 ? '+' : ''}${bh.toFixed(1)}%  ` +
      `(=> ${fmtUsd(capital * (1 + bh / 100))}), maxDD ${(bhDd * 100).toFixed(1)}%\n`,
  );

  const candidates = (b: Cfg): { name: string; cfg: Cfg }[] => [
    { name: 'breakout trần (không nén, không vol)', cfg: { ...b, maxRangePct: 100 } },
    { name: 'breakout + nén<=15%', cfg: { ...b } },
    { name: 'breakout + nén<=15% + EMA200', cfg: { ...b, e200: 'above' } },
    { name: 'breakout + nén + cạn-min0.8/5d', cfg: { ...b, dryMode: 'min', dryDays: 5, dryMult: 0.8 } },
    { name: 'ĐỦ BỘ (nén+cạn+nổ vol+E200)', cfg: { ...b, e200: 'above', dryMode: 'min', dryDays: 5, dryMult: 0.5, volMult: 2 } },
    { name: 'breakout trần + chandelier', cfg: { ...b, maxRangePct: 100, exit: 'chandel' } },
    { name: 'breakout + nén + EMA200 + chandelier', cfg: { ...b, e200: 'above', exit: 'chandel' } },
  ];

  const base: Cfg = {
    n: 20, maxRangePct: 15, dryMult: 0, dryDays: 5, dryMode: 'min', volMult: 0,
    e200: 'off', exit: 'utbot', kv: 2, atrMult: 3, tpPct: 20, slPct: 8,
  };

  if (mode === 'oos') {
    console.log('=== Kiểm tra out-of-sample: cùng config, các giai đoạn khác nhau ===');
    header();
    for (const { name, cfg } of candidates(base)) {
      const r = simulate(all, startIdx, cfg, capital, feePerSide);
      console.log(
        name.padEnd(42) +
          `  ${String(r.trades.length).padStart(6)}  ${r.winPct.toFixed(0).padStart(3)}%  ` +
          `${fmtUsd(r.equity).padStart(11)}  ${r.retPct.toFixed(1).padStart(8)}%  ${r.maxDdPct.toFixed(1).padStart(6)}%  ` +
          `${r.exposurePct.toFixed(0).padStart(5)}%  ${(r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)).padStart(5)}  ` +
          `${fmtUsd(r.randomEquiv).padStart(9)}  ${(r.edgePct >= 0 ? '+' : '') + r.edgePct.toFixed(0)}%`,
      );
    }
    return;
  }

  // ---- 1. exit method, gates off
  console.log('=== 1. Chọn cách thoát lệnh (chưa bật bộ lọc volume / EMA200) ===');
  header();
  for (const exit of ['utbot', 'chandel', 'ema20', 'tpsl'] as ExitMode[]) {
    const cfg = { ...base, exit };
    printRow(cfg, simulate(all, startIdx, cfg, capital, feePerSide));
  }

  // ---- 2. compression tightness
  console.log('\n=== 2. Độ nén: cửa sổ N và biên độ tối đa (thoát = UTBot kv2) ===');
  header();
  for (const n of [15, 20, 30, 40]) {
    for (const maxRangePct of [8, 12, 15, 20, 100]) {
      const cfg = { ...base, n, maxRangePct };
      printRow(cfg, simulate(all, startIdx, cfg, capital, feePerSide));
    }
  }

  // ---- 3. the volume gates that the 19-21/08 move showed
  console.log('\n=== 3a. Cổng volume NỔ khi phá (N20, rng<=15%, chưa lọc cạn) ===');
  header();
  for (const volMult of [0, 1.2, 1.5, 2.0, 2.5]) {
    const cfg = { ...base, volMult };
    printRow(cfg, simulate(all, startIdx, cfg, capital, feePerSide));
  }

  console.log('\n=== 3b. Cổng CẠN volume trước cú phá — 2 cách đo ===');
  console.log('   avg = trung bình N ngày trước; min = ngày thấp nhất trong N ngày trước (đúng với 16/08: 0.38x)');
  header();
  for (const dryMode of ['avg', 'min'] as const) {
    for (const dryDays of [3, 5]) {
      for (const dryMult of [0.8, 0.6, 0.5]) {
        const cfg: Cfg = { ...base, dryMode, dryDays, dryMult };
        printRow(cfg, simulate(all, startIdx, cfg, capital, feePerSide));
      }
    }
  }

  console.log('\n=== 3c. Cạn (min 0.5x/5d) + nổ — đúng công thức quan sát được ===');
  header();
  for (const volMult of [0, 1.5, 2.0]) {
    const cfg: Cfg = { ...base, dryMode: 'min', dryDays: 5, dryMult: 0.5, volMult };
    printRow(cfg, simulate(all, startIdx, cfg, capital, feePerSide));
  }

  // ---- 4. EMA200 filter
  console.log('\n=== 4. Bộ lọc EMA200 (close phải trên EMA200) ===');
  header();
  for (const e200 of ['off', 'above'] as const) {
    for (const volMult of [0, 2.0]) {
      const cfg = { ...base, e200, volMult };
      printRow(cfg, simulate(all, startIdx, cfg, capital, feePerSide));
    }
  }

  // ---- 5. best-guess combos across exits
  console.log('\n=== 5. Kết hợp đầy đủ (nén + cạn vol + nổ vol + EMA200) x từng cách thoát ===');
  header();
  for (const exit of ['utbot', 'chandel', 'ema20', 'tpsl'] as ExitMode[]) {
    for (const e200 of ['off', 'above'] as const) {
      const cfg: Cfg = { ...base, exit, e200, dryMode: 'min', dryDays: 5, dryMult: 0.5, volMult: 2.0 };
      printRow(cfg, simulate(all, startIdx, cfg, capital, feePerSide));
    }
  }

  if (mode === 'detail') {
    const cfgs: Cfg[] = [
      { ...base, maxRangePct: 100 },
      { ...base, e200: 'above' as const },
    ];
    for (const cfg of cfgs) {
      const r = simulate(all, startIdx, cfg, capital, feePerSide);
      console.log(`\n--- Trades: ${label(cfg)} ---`);
      console.log('  entry        exit         entry$      exit$      net%   bars  reason');
      for (const t of r.trades) {
        console.log(
          `  ${fmtDate(t.entryDate)}   ${fmtDate(t.exitDate)}  ${fmtUsd(t.entry).padStart(9)}  ${fmtUsd(t.exit).padStart(9)}  ` +
            `${t.netPct.toFixed(1).padStart(7)}%  ${String(t.bars).padStart(4)}  ${t.reason}`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
