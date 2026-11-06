/**
 * "/backtest" for the AI chats — the in-app version of what the trader used to do in Claude Code
 * (claude-backtest/README.md): describe a strategy, Claude writes the backtest, runs it on real
 * Binance data and logs a write-up. A skill opts in by adding BACKTEST_TOOLS to its `tools` and
 * BACKTEST_PROMPT to its system prompt.
 */

export const BACKTEST_TOOLS = ['run_backtest', 'save_backtest_report', 'list_backtest_runs', 'get_backtest_run'] as const;

export const BACKTEST_PROMPT = `## Backtest — lệnh "/backtest"
Tin nhắn bắt đầu bằng "/backtest" (hoặc user nói rõ "backtest …") = yêu cầu BACKTEST chiến lược, KHÔNG phải yêu cầu vào lệnh. Không tạo thẻ lệnh trong lượt này.
- "/backtest <mô tả>" → backtest đúng chiến lược được mô tả.
- "/backtest" không kèm mô tả → backtest chiến lược / setup vừa bàn gần nhất trong cuộc trò chuyện; "/backtest skill" → get_short_skill rồi backtest phần luật đo được của skill.
- "/backtest lại …", "đổi TP thành …" → get_backtest_run / list_backtest_runs để lấy code cũ, sửa đúng chỗ, chạy lại.
- Thiếu thông tin quan trọng không suy ra được (vd không biết coin nào) → chọn mặc định hợp lý và GHI RÕ giả định; chỉ hỏi lại khi thật sự không thể chạy.

### Quy trình (làm hết trong một lượt)
1. Viết lại chiến lược thành luật cơ học: khung thời gian, điều kiện vào, giá khớp, DCA (nếu có), TP / SL / điều kiện thoát, kích thước lệnh. Phần phán đoán chủ quan ("nhìn yếu", tin tức) không backtest được → nêu rõ đã bỏ qua hoặc thay bằng quy tắc nào.
2. Mặc định khi user không nói: 1 năm (days 365), phí 0.05%/chiều, vốn $1000, sizeUsd 100/lệnh, futures Binance. Coin: coin user nêu; không nêu → BTCUSDT, ETHUSDT, SOLUSDT. Chiến lược của chat này là SHORT thì backtest side 'short'.
3. Gọi run_backtest. Lỗi → đọc lỗi/stack, sửa code, chạy lại (tối đa 3 lần). Có tham số nhạy (TP %, ngưỡng RSI…) → được chạy thêm 1–3 biến thể để so sánh, đặt tham số vào params.
4. Kiểm tra độ hợp lý: 0 lệnh, lệnh dính nhau bất thường, win rate 100%… → xem lại code trước khi kết luận.
5. Gọi save_backtest_report(runId, report) với báo cáo Markdown: Chiến lược (luật đã test + giả định) · Cấu hình (coin, khung, số ngày, phí, vốn) · Bảng kết quả (lệnh, win rate, PnL ròng, lợi nhuận/vốn, max DD, MAE max/p90, giữ lệnh TB/max, số lệnh còn mở) · nếu có biến thể: bảng so sánh kèm runId · Nhận xét 1 đoạn (đáng dùng không, điểm yếu, rủi ro gồng lỗ khi không SL).
6. Trả lời user: kết luận trước, rồi bảng kết quả, nhận xét, runId. Nhắc rằng kết quả chưa tính slippage & funding. Nếu user đang cân nhắc sửa skill: nói rõ có nên lưu vào skill hay không — KHÔNG tự lưu skill, chờ user bảo.

### Hợp đồng code của run_backtest
\`code\` là THÂN của một hàm đồng bộ \`function (ctx, ta, core)\` và phải \`return { trades: [...], summary? }\`. JavaScript thuần, không async, không require, không mạng.
- ctx.data[SYMBOL][interval] → mảng nến ĐÃ ĐÓNG, cũ → mới: { time, closeTime, open, high, low, close, volume } (time/closeTime = ms epoch). Có thêm ~300 nến warm-up trước ctx.fromMs.
- ctx.symbols, ctx.intervals, ctx.params (object bạn truyền), ctx.fromMs (bắt đầu giai đoạn test), ctx.toMs, ctx.feePctPerSide, ctx.capitalUsd, ctx.log(...) để debug (tối đa 300 dòng).
- Mỗi lệnh: { symbol, side: 'short'|'long', entryTime, entryPrice, exitTime, exitPrice, sizeUsd?, tag? }
  - DCA: thay entryTime/entryPrice bằng entries: [{ time, price, sizeUsd }, …] — server tự tính giá vốn trung bình.
  - Lệnh chưa thoát đến hết dữ liệu: exitTime: null (server định giá theo giá đóng cuối, báo riêng ở "open").
  - Chỉ vào lệnh khi time >= ctx.fromMs (lệnh trong warm-up bị bỏ).
- Server tự tính: phí, PnL, win rate, profit factor, drawdown trên vốn, MAE/MFE (độ âm/dương sâu nhất khi giữ lệnh, theo khung nhỏ nhất đã tải), số lệnh mở cùng lúc, theo coin / theo tháng. KHÔNG tự tính các số này trong code.
- ta.* (mảng thẳng hàng với nến, NaN khi chưa đủ dữ liệu): closes/opens/highs/lows/volumes(candles), sma, ema, rma, rsi(src, 14), atr(candles, 14), tr, stdev, bb(src, 20, 2) → {mid, upper, lower}, macd(src) → {macd, signal, hist}, highest/lowest(src, n), crossover/crossunder(a, b|number, i), pct(from, to), pivots(candles, left, right) → {highs, lows} mỗi pivot có confirmedIndex, lastClosedIndex(candles, timeMs), indexAtOrAfter(candles, timeMs).
  Chỉ báo của app: ta.qqe(closes) (mặc định 10/4/3.2 như app) → {rsiMa, signal, cross: 'long'|'short'|null}, ta.supertrend(candles, 10, 3) → [{value, bullish}], ta.utbot(candles, atrPeriod, keyValue) → [{uptrend, buySignal, sellSignal, stopLevel}], ta.stochRsi(closes) → {k, d}. \`src\` nhận mảng số hoặc mảng nến (dùng close).

### Chống nhìn trước tương lai (look-ahead) — bắt buộc
- Tín hiệu tính trên nến i (đã đóng) → vào lệnh ở open của nến i+1 (hoặc close nến i nếu luật nói "vào khi đóng nến"). Không dùng high/low/close của nến chưa xảy ra.
- Đọc khung lớn khi đang lặp khung nhỏ: j = ta.lastClosedIndex(htf, ltf[i].closeTime) → chỉ dùng htf[0..j].
- Pivot chỉ được dùng từ confirmedIndex trở đi.
- TP/SL trong cùng một nến: nếu nến chạm cả TP lẫn SL → giả định SL trước (bảo thủ). TP khớp đúng giá TP, không lấy close.
- Lệnh limit: chỉ khớp khi nến sau đó chạm giá limit.

### Mẫu code (SHORT khi RSI H4 cắt xuống 70, TP 5%, không SL, thoát nếu giữ quá N ngày)
\`\`\`js
const { tpPct = 5, maxDays = 30 } = ctx.params;
const trades = [];
for (const symbol of ctx.symbols) {
  const c = ctx.data[symbol]['4h'];
  const rsi = ta.rsi(c, 14);
  let pos = null;
  for (let i = 1; i < c.length - 1; i++) {
    if (pos) {
      const tp = pos.entryPrice * (1 - tpPct / 100);
      const bar = c[i];
      if (bar.low <= tp) { trades.push({ ...pos, exitTime: bar.closeTime, exitPrice: tp }); pos = null; continue; }
      if (bar.closeTime - pos.entryTime > maxDays * 86400000) { trades.push({ ...pos, exitTime: bar.closeTime, exitPrice: bar.close, tag: 'time' }); pos = null; }
      continue;
    }
    if (c[i].time < ctx.fromMs) continue;
    if (ta.crossunder(rsi, 70, i)) {
      const next = c[i + 1];
      pos = { symbol, side: 'short', entryTime: next.time, entryPrice: next.open, sizeUsd: 100 };
    }
  }
  if (pos) trades.push({ ...pos, exitTime: null });
}
return { trades };
\`\`\``;
