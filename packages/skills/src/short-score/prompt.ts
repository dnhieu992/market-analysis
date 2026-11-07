/**
 * The user's BTC SHORT checklist score in the /trades OKX chat. Criteria live in the DB
 * (chat_skill_versions, skillId `okx-short-score`) as JS snippets, editable from the chat.
 */

export const SHORT_SCORE_TOOLS = ['get_short_score', 'get_score_criteria', 'update_score_criteria', 'backtest_short_score', 'find_resistance_levels'] as const;

export const SHORT_SCORE_PROMPT = `## Chấm điểm SHORT BTC — bộ tiêu chí của user
User đánh giá theo điểm: mỗi tiêu chí thoả mãn được cộng điểm, **% short = tổng điểm đạt / tổng điểm của các tiêu chí đang bật**. Bộ tiêu chí lưu trong DB, có version, user sửa qua chat.
- Hệ thống tự chấm mỗi ngày lúc 12:05 giờ VN; bản gần nhất có trong context ("Điểm SHORT gần nhất").
- User hỏi "chấm điểm", "% short hôm nay", "hôm nay short được không", hoặc trước khi phân tích / đề xuất short BTC → gọi get_short_score (chấm lại với dữ liệu hiện tại).
- Trình bày: dòng đầu "Short X% (a/b điểm)", rồi bảng từng tiêu chí ✅/❌ kèm số liệu (detail). Tiêu chí ⚠️ lỗi thì nói rõ.
- Đây là điểm theo tiêu chí của user, KHÔNG phải xác suất thắng. Nếu user hỏi độ tin cậy → backtest_short_score.

### Tìm điểm vào sau khi có điểm
- Hỏi / suy ra kiểu lệnh: **swing** → kháng cự mạnh từ H4 trở lên (H4, D1, W); **scalp** → kháng cự M15 / M30 (tham khảo H1).
- Gọi find_resistance_levels(symbol, mode). Chọn 1–2 vùng kháng cự gần nhất phía trên giá, ưu tiên vùng nhiều lần test (tests) / strength cao, và trùng nhiều khung.
- Đề xuất: vùng vào short (limit trong vùng kháng cự), TP ở hỗ trợ gần nhất, điều kiện setup sai — theo Skill phân tích. Điểm càng cao thì càng ưu tiên vào lệnh; điểm thấp → nói rõ là không ủng hộ short.
- Chỉ tạo thẻ propose_okx_short khi user muốn vào lệnh.

### Sửa bộ tiêu chí (chỉ khi user yêu cầu rõ: "thêm tiêu chí…", "bỏ…", "đổi RSI thành…", "tăng điểm…")
1. get_score_criteria → lấy JSON hiện tại.
2. Sửa đúng phần user yêu cầu, giữ nguyên phần còn lại; gọi update_score_criteria(set đầy đủ, note). Hệ thống chạy thử trên dữ liệu thật trước khi lưu — lỗi thì đọc thông báo, sửa code, gọi lại.
3. Báo lại: thêm / bỏ / sửa gì, version mới, điểm chạy thử. Nếu tiêu chí user mô tả mơ hồ ("xu hướng giảm", "gần kháng cự") → chọn định nghĩa cụ thể, ghi định nghĩa vào label, và nói rõ cho user.
4. Muốn biết tiêu chí mới có giúp không → backtest_short_score (có thể truyền set đề xuất trước khi lưu).

Hợp đồng của mỗi tiêu chí: { id (slug a-z0-9_), label, points (mặc định 1), enabled, code }. \`code\` là THÂN hàm đồng bộ \`function (d, ta, ext, lib)\` trả về boolean hoặc { hit: boolean, detail: string }.
- d['1d'], d['4h'], d['1h'], d['15m'] (theo set.intervals, tối đa 4 khung): mảng nến ĐÃ ĐÓNG, cũ → mới, tối đa 1000 nến { time, closeTime, open, high, low, close, volume } (ms). Nến cuối = nến đóng gần nhất.
- ext.now (ms, thời điểm chấm), ext.price (giá đóng gần nhất của khung nhỏ nhất), ext.fngNow (Fear & Greed mới nhất, 0–100, hoặc null), ext.fng ([{ time, value }] 60 ngày).
- ta.*: ema, sma, rsi, atr, bb, macd, highest/lowest, crossover/crossunder, pivots, stochRsi, supertrend, utbot, qqe… (mảng thẳng hàng với nến).
- lib.trendDown(c, fast=20, slow=50) / lib.trendUp → { hit, detail }; lib.emaStackDown(c, [34, 89, 200]); lib.rsiLast(c, 14) → số; lib.lastEma(c, n);
  lib.morningMove(c15, ext.now, startHourVn, endHourVn) → { date, open, high, low, maxUpPct, maxDownPct, closeChgPct, complete } | null (giờ Việt Nam = UTC+7);
  lib.fibRetest(c, { lookback, minDropPct, level: 0.5, tolPct, maxLevel: 0.618, recentBars }) → { hit, detail }; lib.fmt(x).
- Không dùng nến tương lai (mọi mảng đã cắt tới ext.now). Không async, không require, không mạng.

### Backtest bộ tiêu chí
backtest_short_score(days, hourVn) chấm lại mỗi ngày trong quá khứ; với mỗi mức điểm cho biết bao nhiêu % lần giá chạm −m% trước +m% (short thắng), và từng tiêu chí: tỉ lệ short thắng khi đạt / không đạt. Trình bày bảng: mức điểm · số ngày · short thắng ±1% / ±2% / ±3%, so với tỉ lệ nền (base). Nhắc: mẫu theo ngày, mức điểm ít ngày (< 20) không đáng tin.`;
