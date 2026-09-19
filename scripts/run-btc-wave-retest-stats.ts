/**
 * Giả thuyết của user: "Sóng BTC thường chạy 1 sóng duy nhất, RẤT HIẾM khi giá
 * quay về test lại các vùng dưới (đáy/hỗ trợ cũ)."
 *
 * Script phân rã lịch sử giá BTC thành các CHÂN SÓNG bằng ZigZag theo % (reversal
 * filter), rồi đo 3 thứ trả lời trực tiếp câu hỏi:
 *
 *   A. Kích thước chân sóng lên vs chân sóng xuống (pullback), và tỉ lệ THOÁI LUI
 *      (retracement) của mỗi pullback so với sóng lên ngay trước nó.
 *        retrace = (đỉnh - đáy_sau) / (đỉnh - đáy_trước)
 *        - retrace nhỏ  -> pullback nông, KHÔNG về vùng dưới  (ủng hộ giả thuyết)
 *        - retrace >= 1 -> pullback nuốt trọn sóng lên, THỦNG đáy cũ (bác giả thuyết)
 *
 *   B. Đáy sau so với đáy trước: % số lần là HIGHER LOW (đáy cao dần, không về test
 *      đáy cũ) và % số lần pullback CHẠM LẠI vùng đáy trước (trong band%).
 *
 *   C. Sau khi giá breakout +X% khỏi một đáy, trong cửa sổ W ngày nó có QUAY VỀ
 *      chạm lại vùng đáy đó (band%) không? % "chạy luôn không về" = sóng 1 nhịp.
 *
 * ZigZag dùng high/low (không phải close) để bắt biên độ thật của swing.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-wave-retest-stats.ts [symbol] [interval] [startYear] [threshList] [band%] [windowDays]
 *   e.g. ... run-btc-wave-retest-stats.ts BTCUSDT 1d 2017 "5,10,15,20" 3 90
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };
type Pivot = { idx: number; price: number; type: 'H' | 'L' };

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

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/** SMA của close, phần tử < period trả về NaN. */
function sma(c: Candle[], period: number): number[] {
  const out = new Array(c.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    sum += c[i]!.close;
    if (i >= period) sum -= c[i - period]!.close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
const median = (a: number[]) => pct(a, 50);

/**
 * ZigZag theo % dựa trên high/low. Trả về chuỗi pivot xen kẽ H, L.
 * threshold = biên độ đảo chiều tối thiểu (vd 0.10 = 10%).
 */
function zigzag(c: Candle[], threshold: number): Pivot[] {
  const pivots: Pivot[] = [];
  if (c.length === 0) return pivots;
  let dir = 0; // 0 chưa xác định, 1 đang lên, -1 đang xuống
  let hi = c[0]!.high;
  let hiIdx = 0;
  let lo = c[0]!.low;
  let loIdx = 0;

  for (let i = 1; i < c.length; i++) {
    const C = c[i]!;
    if (dir === 0) {
      if (C.high > hi) { hi = C.high; hiIdx = i; }
      if (C.low < lo) { lo = C.low; loIdx = i; }
      if (C.low <= hi * (1 - threshold)) {
        pivots.push({ idx: hiIdx, price: hi, type: 'H' });
        dir = -1; lo = C.low; loIdx = i;
      } else if (C.high >= lo * (1 + threshold)) {
        pivots.push({ idx: loIdx, price: lo, type: 'L' });
        dir = 1; hi = C.high; hiIdx = i;
      }
    } else if (dir > 0) {
      if (C.high > hi) { hi = C.high; hiIdx = i; }
      if (C.low <= hi * (1 - threshold)) {
        pivots.push({ idx: hiIdx, price: hi, type: 'H' });
        dir = -1; lo = C.low; loIdx = i;
      }
    } else {
      if (C.low < lo) { lo = C.low; loIdx = i; }
      if (C.high >= lo * (1 + threshold)) {
        pivots.push({ idx: loIdx, price: lo, type: 'L' });
        dir = 1; hi = C.high; hiIdx = i;
      }
    }
  }
  return pivots;
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const interval = process.argv[3] ?? '1d';
  const startYear = parseInt(process.argv[4] ?? '2017', 10);
  const threshList = (process.argv[5] ?? '5,10,15,20').split(',').map((x) => parseFloat(x.trim()));
  const band = parseFloat(process.argv[6] ?? '3'); // "chạm lại vùng đáy" = low <= đáy*(1+band%)
  const windowDays = parseInt(process.argv[7] ?? '90', 10);

  const all = await fetchKlines(symbol, interval, Date.UTC(startYear, 0, 1), Date.now());
  const n = all.length;
  if (n < 30) { console.error('Không đủ dữ liệu'); process.exit(1); }

  console.log(`${symbol} ${interval}  |  ${fmtDate(all[0]!.openTime)} -> ${fmtDate(all[n - 1]!.openTime)}  (${n} nến)`);
  console.log(`Giá đầu: $${all[0]!.close.toLocaleString()}  ->  giá cuối: $${all[n - 1]!.close.toLocaleString()}`);
  console.log(`band (vùng chạm lại đáy) = ±${band}%   |   cửa sổ quan sát breakout = ${windowDays} nến`);
  const sma200 = sma(all, 200);
  console.log(`Regime = close vs SMA200 (bull: close > SMA200)\n`);

  for (const t of threshList) {
    const T = t / 100;
    const piv = zigzag(all, T);
    console.log('='.repeat(100));
    console.log(`### ZigZag reversal = ${t}%   ->   ${piv.length} pivot`);
    console.log('='.repeat(100));
    if (piv.length < 4) { console.log('  (quá ít pivot ở ngưỡng này)\n'); continue; }

    // ---- A. chân sóng lên / xuống + tỉ lệ thoái lui ----
    const upLegs: number[] = [];
    const downLegs: number[] = [];
    const retrace: number[] = []; // pullback / sóng lên ngay trước
    for (let k = 1; k < piv.length; k++) {
      const a = piv[k - 1]!;
      const b = piv[k]!;
      if (a.type === 'L' && b.type === 'H') {
        upLegs.push((b.price / a.price - 1) * 100);
      } else if (a.type === 'H' && b.type === 'L') {
        downLegs.push((1 - b.price / a.price) * 100);
        // sóng lên ngay trước đỉnh a
        if (k - 2 >= 0 && piv[k - 2]!.type === 'L') {
          const prevLow = piv[k - 2]!.price;
          const gainAbs = a.price - prevLow;
          const dropAbs = a.price - b.price;
          if (gainAbs > 0) retrace.push(dropAbs / gainAbs);
        }
      }
    }
    const big = (arr: number[], th: number) => `${arr.filter((x) => x >= th).length}/${arr.length}=${((arr.filter((x) => x >= th).length / arr.length) * 100).toFixed(0)}%`;
    console.log(`\nA. Chân sóng LÊN: ${upLegs.length} sóng | median +${median(upLegs).toFixed(1)}%  (p25 +${pct(upLegs, 25).toFixed(1)}%, p75 +${pct(upLegs, 75).toFixed(1)}%, max +${Math.max(...upLegs).toFixed(0)}%)`);
    console.log(`   Một mạch chạy KHÔNG có nhịp chỉnh ${t}%:  >=+20%: ${big(upLegs, 20)}  |  >=+30%: ${big(upLegs, 30)}  |  >=+50%: ${big(upLegs, 50)}`);
    console.log(`   Chân sóng XUỐNG (pullback): ${downLegs.length} sóng | median -${median(downLegs).toFixed(1)}%  (p25 -${pct(downLegs, 25).toFixed(1)}%, p75 -${pct(downLegs, 75).toFixed(1)}%, max -${Math.max(...downLegs).toFixed(0)}%)`);
    if (retrace.length) {
      const deep = retrace.filter((r) => r >= 0.618).length;
      const full = retrace.filter((r) => r >= 1).length;
      console.log(`   Tỉ lệ THOÁI LUI của pullback so với sóng lên trước đó (${retrace.length} cặp):`);
      console.log(`     median ${(median(retrace) * 100).toFixed(0)}% | p75 ${(pct(retrace, 75) * 100).toFixed(0)}% | p90 ${(pct(retrace, 90) * 100).toFixed(0)}%`);
      console.log(`     pullback sâu (>=61.8% sóng trước): ${deep}/${retrace.length} = ${((deep / retrace.length) * 100).toFixed(0)}%`);
      console.log(`     pullback THỦNG đáy cũ (>=100%):     ${full}/${retrace.length} = ${((full / retrace.length) * 100).toFixed(0)}%   <- số lần THẬT SỰ về test/thủng vùng dưới`);
    }

    // ---- B. đáy sau vs đáy trước ----
    const lows = piv.filter((p) => p.type === 'L');
    let higherLow = 0, retestPrior = 0, brokePrior = 0;
    const lowGaps: number[] = [];
    for (let k = 1; k < lows.length; k++) {
      const prev = lows[k - 1]!.price;
      const cur = lows[k]!.price;
      lowGaps.push((cur / prev - 1) * 100);
      if (cur > prev) higherLow++;
      if (cur <= prev * (1 + band / 100) && cur >= prev) retestPrior++; // về sát đáy cũ nhưng không thủng
      if (cur < prev) brokePrior++;
    }
    if (lowGaps.length) {
      console.log(`\nB. Đáy sau so với đáy trước (${lowGaps.length} cặp đáy liên tiếp):`);
      console.log(`   HIGHER LOW (đáy cao hơn, không về đáy cũ): ${higherLow}/${lowGaps.length} = ${((higherLow / lowGaps.length) * 100).toFixed(0)}%`);
      console.log(`   về SÁT đáy cũ (trong +${band}%, không thủng):  ${retestPrior}/${lowGaps.length} = ${((retestPrior / lowGaps.length) * 100).toFixed(0)}%`);
      console.log(`   THỦNG đáy cũ (đáy thấp hơn):                 ${brokePrior}/${lowGaps.length} = ${((brokePrior / lowGaps.length) * 100).toFixed(0)}%`);
      console.log(`   median khoảng cách đáy sau vs đáy trước: ${median(lowGaps) >= 0 ? '+' : ''}${median(lowGaps).toFixed(1)}%`);
    }

    // ---- C. sau breakout, giá có quay về chạm lại đáy trong windowDays không? ----
    // Với mỗi đáy pivot, tìm điểm giá vượt +t% (đã là định nghĩa zigzag up-leg),
    // rồi từ ĐỈNH kế tiếp nhìn về phía trước windowDays: low có <= đáy*(1+band)?
    // 3 nhóm x 2 regime (bull/bear tại đỉnh breakout)
    const cnt = { bull: { ran: 0, ret: 0, broke: 0 }, bear: { ran: 0, ret: 0, broke: 0 } };
    for (let k = 0; k < piv.length - 1; k++) {
      if (piv[k]!.type !== 'L') continue;
      const low = piv[k]!.price;
      const highPiv = piv[k + 1]!; // đỉnh của sóng lên
      if (highPiv.type !== 'H') continue;
      const startIdx = highPiv.idx;
      const endIdx = Math.min(n - 1, startIdx + windowDays);
      const reg = !isNaN(sma200[startIdx]!) && all[startIdx]!.close > sma200[startIdx]! ? 'bull' : 'bear';
      let touched = false, broke = false;
      for (let j = startIdx + 1; j <= endIdx; j++) {
        if (all[j]!.low < low) { broke = true; break; }
        if (all[j]!.low <= low * (1 + band / 100)) { touched = true; break; }
      }
      if (broke) cnt[reg].broke++;
      else if (touched) cnt[reg].ret++;
      else cnt[reg].ran++;
    }
    const show = (r: 'bull' | 'bear') => {
      const g = cnt[r];
      const tot = g.ran + g.ret + g.broke;
      if (!tot) return `   ${r.toUpperCase()}: (không có mẫu)`;
      return `   ${r.toUpperCase()} (${tot} đáy): chạy luôn ${((g.ran / tot) * 100).toFixed(0)}% | retest-hold ${((g.ret / tot) * 100).toFixed(0)}% | thủng đáy ${((g.broke / tot) * 100).toFixed(0)}%`;
    };
    console.log(`\nC. Sau khi tạo đáy + sóng lên, trong ${windowDays} nến kế giá có QUAY VỀ chạm lại vùng đáy (±${band}%)?`);
    console.log(show('bull'));
    console.log(show('bear'));

    // ---- D. cấu trúc sóng GẦN NHẤT + nhịp chỉnh sâu nhất của sóng đang chạy ----
    const last = piv.slice(-6);
    const recent = last.map((p) => `${p.type} $${(p.price / 1000).toFixed(1)}k ${fmtDate(all[p.idx]!.openTime)}`).join('  →  ');
    console.log(`\nD. 6 pivot gần nhất: ${recent}`);
    // Sóng đang chạy: từ pivot cuối tới hiện tại
    const lastPiv = piv[piv.length - 1]!;
    if (lastPiv.type === 'L') {
      // đang trong sóng lên: đo max run + nhịp chỉnh sâu nhất kể từ đáy cuối
      let runHigh = lastPiv.price, deepest = 0;
      for (let j = lastPiv.idx + 1; j < n; j++) {
        runHigh = Math.max(runHigh, all[j]!.high);
        deepest = Math.max(deepest, (1 - all[j]!.low / runHigh) * 100);
      }
      console.log(`   Sóng đang chạy từ đáy $${(lastPiv.price / 1000).toFixed(1)}k (${fmtDate(all[lastPiv.idx]!.openTime)}): đã chạy tối đa +${((runHigh / lastPiv.price - 1) * 100).toFixed(1)}%, nhịp chỉnh SÂU NHẤT trong sóng chỉ -${deepest.toFixed(1)}%`);
    }
    console.log('');
  }

  console.log('Ghi chú: ZigZag dựa trên high/low, cửa sổ forward ở phần C chồng lấn theo pivot.');
  console.log('Kết quả phụ thuộc mạnh vào ngưỡng reversal (t%) — đọc nhiều ngưỡng cùng lúc.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
