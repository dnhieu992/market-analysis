/**
 * "BTC D1 cách đường UTBot giảm bao nhiêu % thì có cú hồi?"
 *
 * Trong xu hướng GIẢM, đường UTBot (Wilder ATR trailing stop) nằm TRÊN giá.
 * Script đo khoảng cách gap% = (stop - close) / close * 100 và trả lời:
 *
 *   1. Phân phối gap% trong toàn bộ các nến bear — giãn tối đa được bao nhiêu?
 *      (kèm gap tính theo đơn vị ATR để thấy giới hạn cơ học của công thức)
 *   2. Chia gap% thành từng khoảng -> lợi nhuận kỳ vọng và xác suất hồi
 *      >= 5% / >= 10% trong 5 / 10 / 20 ngày kế tiếp, và xác suất lật bull.
 *   3. Điểm KHỞI ĐẦU cú hồi: quét zigzag tìm mọi đáy cục bộ mà từ đó giá
 *      bật >= threshold% trước khi tạo đáy thấp hơn, rồi xem gap% tại đáy đó
 *      là bao nhiêu. Đây là câu trả lời trực tiếp nhất cho câu hỏi.
 *   4. Cú hồi đi được bao xa, và bao nhiêu % số lần chạm lại được đường UTBot.
 *
 * Lưu ý đọc số ở mục 2: các cửa sổ forward chồng lấn nhau (mỗi nến một quan
 * sát), nên đây là phân phối có điều kiện, không phải chuỗi lệnh độc lập.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-utbot-gap-bounce-stats.ts [symbol] [startYear] [kvList]
 *   e.g. ... run-utbot-gap-bounce-stats.ts BTCUSDT 2020 "1,2,3"
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;
/** Cú hồi chỉ được đo trong ngần này ngày kể từ đáy — xem ghi chú trong vòng lặp. */
const RALLY_WINDOW = 30;

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

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const startYear = parseInt(process.argv[3] ?? '2020', 10);
  const kvList = (process.argv[4] ?? '1,2,3').split(',').map((x) => parseFloat(x.trim()));

  const all = await fetchKlines(symbol, '1d', Date.UTC(startYear - 2, 0, 1), Date.now());
  const scanStart = Date.UTC(startYear, 0, 1);
  const s0 = all.findIndex((c) => c.openTime.getTime() >= scanStart);
  const n = all.length;

  console.log(`${symbol} 1d  |  ${fmtDate(all[s0]!.openTime)} -> ${fmtDate(all[n - 1]!.openTime)}  (${n - s0} nến)`);
  console.log(`UTBot: Wilder ATR(${ATR_PERIOD}), gap% = (stop - close) / close x 100, chỉ tính nến trong xu hướng BEAR\n`);

  const atr = wilderAtr(all, ATR_PERIOD);

  for (const kv of kvList) {
    const stop = utBotStops(all, ATR_PERIOD, kv);
    const trend = all.map((x, i) => (i < ATR_PERIOD || stop[i] === 0 ? null : x.close > stop[i]! ? 'bull' : 'bear'));

    console.log(`${'='.repeat(96)}`);
    console.log(`### keyValue = ${kv}`);
    console.log(`${'='.repeat(96)}`);

    // ---------- 1. phân phối gap trong bear
    const gaps: number[] = [];
    const gapsAtr: number[] = [];
    const bearIdx: number[] = [];
    for (let i = Math.max(s0, ATR_PERIOD); i < n; i++) {
      if (trend[i] !== 'bear') continue;
      const g = ((stop[i]! - all[i]!.close) / all[i]!.close) * 100;
      gaps.push(g);
      gapsAtr.push((stop[i]! - all[i]!.close) / atr[i]!);
      bearIdx.push(i);
    }
    const bearPct = (bearIdx.length / (n - Math.max(s0, ATR_PERIOD))) * 100;
    console.log(`\n1. Phân phối gap% trong ${bearIdx.length} nến bear (${bearPct.toFixed(0)}% thời gian)`);
    console.log('   p10    p25   median    p75    p90    p95    p99    max   |  median theo ATR   max theo ATR');
    console.log(
      `  ${pct(gaps, 10).toFixed(2).padStart(5)}% ${pct(gaps, 25).toFixed(2).padStart(5)}% ${pct(gaps, 50).toFixed(2).padStart(6)}% ` +
        `${pct(gaps, 75).toFixed(2).padStart(6)}% ${pct(gaps, 90).toFixed(2).padStart(6)}% ${pct(gaps, 95).toFixed(2).padStart(6)}% ` +
        `${pct(gaps, 99).toFixed(2).padStart(6)}% ${Math.max(...gaps).toFixed(2).padStart(6)}%  |  ` +
        `${pct(gapsAtr, 50).toFixed(2).padStart(10)} ATR ${Math.max(...gapsAtr).toFixed(2).padStart(8)} ATR`,
    );

    // ---------- 2. bucket gap -> forward behaviour
    const buckets: [number, number][] = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 12], [12, 100]];
    console.log(`\n2. Theo khoảng gap: giá làm gì sau đó (cửa sổ chồng lấn, đọc như phân phối có điều kiện)`);
    console.log('   gap%        nến   MFE5d   MFE10d  MFE20d   P(hồi>=5% trong 10d)  P(hồi>=10% trong 20d)  P(lật bull 20d)');
    for (const [lo, hi] of buckets) {
      const idxs = bearIdx.filter((i) => {
        const g = ((stop[i]! - all[i]!.close) / all[i]!.close) * 100;
        return g >= lo && g < hi;
      });
      if (idxs.length < 5) continue;
      const mfe = (i: number, d: number) => {
        let m = 0;
        for (let j = i + 1; j <= Math.min(n - 1, i + d); j++) m = Math.max(m, ((all[j]!.high - all[i]!.close) / all[i]!.close) * 100);
        return m;
      };
      const flip = (i: number, d: number) => {
        for (let j = i + 1; j <= Math.min(n - 1, i + d); j++) if (trend[j] === 'bull') return true;
        return false;
      };
      const m5 = idxs.map((i) => mfe(i, 5));
      const m10 = idxs.map((i) => mfe(i, 10));
      const m20 = idxs.map((i) => mfe(i, 20));
      const p5 = (m10.filter((x) => x >= 5).length / idxs.length) * 100;
      const p10 = (m20.filter((x) => x >= 10).length / idxs.length) * 100;
      const pf = (idxs.filter((i) => flip(i, 20)).length / idxs.length) * 100;
      console.log(
        `  ${`${lo}-${hi === 100 ? '∞' : hi}%`.padEnd(9)} ${String(idxs.length).padStart(5)}  ` +
          `${mean(m5).toFixed(1).padStart(6)}% ${mean(m10).toFixed(1).padStart(7)}% ${mean(m20).toFixed(1).padStart(7)}%  ` +
          `${p5.toFixed(0).padStart(18)}%  ${p10.toFixed(0).padStart(20)}%  ${pf.toFixed(0).padStart(14)}%`,
      );
    }

    // ---------- 3. gap tại ĐÁY khởi đầu cú hồi (zigzag)
    console.log(`\n3. Gap% tại ĐÁY mà từ đó giá bật lên (zigzag, chỉ tính đáy nằm trong bear)`);
    console.log(`   (cú hồi đo trong tối đa ${RALLY_WINDOW} ngày kể từ đáy)`);
    console.log('   ngưỡng hồi    số cú   gap tại đáy: p25 / median / p75 / p90   hồi:med / p90   % chạm lại đường UTBot');
    for (const thresh of [5, 10, 15, 20]) {
      const origins: { idx: number; gap: number; rally: number; touched: boolean }[] = [];
      let lowIdx = -1;
      let lowPx = Infinity;
      for (let i = Math.max(s0, ATR_PERIOD); i < n; i++) {
        if (all[i]!.low < lowPx) {
          lowPx = all[i]!.low;
          lowIdx = i;
        }
        if (lowIdx >= 0 && all[i]!.high >= lowPx * (1 + thresh / 100)) {
          if (trend[lowIdx] === 'bear') {
            // Cú hồi chạy tới đâu trước khi thủng đáy cũ, GIỚI HẠN trong RALLY_WINDOW ngày.
            // Không chặn cửa sổ thì cú hồi từ đáy chu kỳ (không bao giờ thủng lại)
            // chạy tới hết lịch sử và cho ra những con số vô nghĩa kiểu +3236%.
            let peak = lowPx;
            let touched = false;
            for (let j = lowIdx + 1; j < Math.min(n, lowIdx + 1 + RALLY_WINDOW); j++) {
              if (all[j]!.low < lowPx) break;
              peak = Math.max(peak, all[j]!.high);
              if (all[j]!.high >= stop[j]!) touched = true;
            }
            origins.push({
              idx: lowIdx,
              gap: ((stop[lowIdx]! - all[lowIdx]!.close) / all[lowIdx]!.close) * 100,
              rally: ((peak - lowPx) / lowPx) * 100,
              touched,
            });
          }
          lowPx = all[i]!.high;
          lowIdx = i;
        }
      }
      if (origins.length === 0) continue;
      const g = origins.map((o) => o.gap);
      const r = origins.map((o) => o.rally);
      console.log(
        `   >=${String(thresh).padStart(2)}%${String(origins.length).padStart(10)}   ` +
          `${pct(g, 25).toFixed(2).padStart(6)}% /${pct(g, 50).toFixed(2).padStart(7)}% /${pct(g, 75).toFixed(2).padStart(7)}% /${pct(g, 90).toFixed(2).padStart(7)}%   ` +
          `${pct(r, 50).toFixed(1).padStart(6)}% /${pct(r, 90).toFixed(1).padStart(6)}%   ` +
          `${((origins.filter((o) => o.touched).length / origins.length) * 100).toFixed(0).padStart(20)}%`,
      );
    }

    // ---------- 4. so sánh gap tại đáy vs gap nền
    const originsBig: number[] = [];
    const originsAtrPct: number[] = [];
    {
      let lowIdx = -1;
      let lowPx = Infinity;
      for (let i = Math.max(s0, ATR_PERIOD); i < n; i++) {
        if (all[i]!.low < lowPx) {
          lowPx = all[i]!.low;
          lowIdx = i;
        }
        if (lowIdx >= 0 && all[i]!.high >= lowPx * 1.1) {
          if (trend[lowIdx] === 'bear') {
            originsBig.push(((stop[lowIdx]! - all[lowIdx]!.close) / all[lowIdx]!.close) * 100);
            originsAtrPct.push((atr[lowIdx]! / all[lowIdx]!.close) * 100);
          }
          lowPx = all[i]!.high;
          lowIdx = i;
        }
      }
    }
    // gap bị chặn cứng ở kv x ATR, nên gap% lớn chỉ có thể xảy ra khi ATR% lớn.
    const atrPctBear = bearIdx.map((i) => (atr[i]! / all[i]!.close) * 100);
    console.log(
      `\n4. Gap trung vị tại đáy của cú hồi >=10%: ${pct(originsBig, 50).toFixed(2)}%  ` +
        `vs gap trung vị của MỌI nến bear: ${pct(gaps, 50).toFixed(2)}%  ` +
        `-> ${pct(originsBig, 50) > pct(gaps, 50) ? 'đáy giãn XA hơn nền' : 'đáy KHÔNG giãn xa hơn nền'}`,
    );
    console.log(
      `   Nhưng: ATR% trung vị tại các đáy đó = ${pct(originsAtrPct, 50).toFixed(2)}%  ` +
        `vs ATR% trung vị mọi nến bear = ${pct(atrPctBear, 50).toFixed(2)}%  ` +
        `(gap bị chặn cứng ở ${kv} x ATR -> gap rộng CHỈ xảy ra khi biến động đã nở)`,
    );
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
