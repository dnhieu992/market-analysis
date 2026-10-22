# Scalping skill

Skill `scalping` trên `/skills`: đọc nến 30m / 15m / 5m như nhìn chart và trả về một kế hoạch scalp cụ thể
(LONG / SHORT / KHÔNG VÀO LỆNH NGAY, loại lệnh, entry, SL, TP1/TP2, R:R sau phí 0.05%/side).

## Thành phần

- `packages/skills/src/scalping/` — system prompt, câu hỏi mẫu, định nghĩa skill.
- `apps/api/src/modules/chat/tools/scalp-chart.tool.ts` — tool `get_scalp_chart_data(symbol)`:
  - Nến Binance spot: 30m × 96 (~2 ngày), 15m × 96 (~1 ngày), 5m × 144 (~12 giờ), dạng CSV gọn
    (`time(UTC),open,high,low,close,volume`). Nến cuối mỗi khung đang chạy (chưa đóng).
  - Mỗi khung: EMA9/21/50, RSI14, ATR14, avg volume 20 + volume ratio của nến đóng gần nhất,
    range high/low, 6 swing high/low gần nhất (fractal 2 nến mỗi bên). Chỉ báo chỉ tính trên nến đã đóng.
  - Phiên UTC hôm nay (từ nến 5m): open / high / low / VWAP.
  - Output ~20KB (~7k tokens).

## Quy tắc chính trong prompt

- 30m = bias, 15m = setup (pullback / breakout-retest / sweep & reclaim / range fade), 5m = trigger.
- SL sau điểm invalidation + 0.2–0.3 × ATR14(5m); quá 1.5 × ATR14(15m) thì bỏ.
- TP1 ≥ 1:1.5 (chốt 50%, dời SL về hoà), TP2 ≥ 1:2.5. Hiển thị R:R sau phí.
- Time stop 30 phút sau khi khớp; huỷ lệnh limit sau 1 giờ nếu chưa khớp.
- Không có setup đạt → "KHÔNG VÀO LỆNH NGAY" + lệnh chờ cho cả hai chiều.

## Accept / Cancel → paper trade trên /trading-analysis

- Claude gọi tool `propose_trade_setup` cho mỗi kế hoạch (tối đa 2) → lưu vào bảng `skill_trade_setups`,
  gắn vào tin nhắn trả lời. Chat hiển thị thẻ setup với nút **Accept** / **Cancel** (`trade-setup-card.tsx`).
- `POST /strategy-paper-trades/skill-setups/:id/accept` (`ScalpSkillPaperService.accept`):
  - Setup phải `PROPOSED`, của chính user, và tạo cách đây ≤ 60 phút.
  - Lấy giá hiện tại: MARKET, hoặc LIMIT/STOP mà giá đã tới entry → khớp ngay ở giá hiện tại (`OPEN`);
    còn lại → `PENDING`, hết hạn sau 60 phút (`EXPIRED`).
  - Từ chối nếu giá hiện tại đã vượt SL hoặc TP1.
  - Tạo `StrategyPaperTrade` với `strategyId = "scalping-skill"`, timeframe 5m, rủi ro = `riskUsd` của config.
- `POST /strategy-paper-trades/skill-setups/:id/cancel`: huỷ setup `PROPOSED`, hoặc lệnh `PENDING` chưa khớp.
- Monitor (cron mỗi phút, giây 20) replay nến 1m từ `lastCheckedAt`:
  - PENDING: LIMIT khớp khi giá hồi về entry, STOP khi phá qua entry (gap → khớp ở giá open).
  - OPEN: SL kiểm trước (cùng nến chạm cả hai → SL). TP1 → chốt 50%, dời SL về giá vào. TP2 → chốt phần còn lại.
  - Trạng thái: `CLOSED_TP`, `CLOSED_SL`, `CLOSED_BE` (TP1 rồi hoà vốn), `EXPIRED`, `CANCELLED`.
  - Không giới hạn thời gian giữ lệnh — chạy tới TP hoặc SL.
- Board: thẻ chiến lược "Scalping Skill (AI)", lệnh chờ khớp hiện trong "Lệnh đang mở"; lệnh huỷ/hết hạn
  nằm trong lịch sử nhưng không tính vào thống kê.

## Nghiên cứu time stop (log đường đi của lệnh)

Prompt có nhắc time stop 30 phút, nhưng engine paper trade **không** áp dụng — lệnh chạy tới TP hoặc SL.
Để chọn time stop dựa trên dữ liệu (khoảng 100 lệnh), mỗi lệnh đã khớp được ghi lại đường đi theo phút:

- Bảng `strategy_paper_trade_paths` (1 dòng / lệnh): `closeR[k]` = R (chưa trừ phí) tại giá đóng nến 1m
  thứ k+1 sau khi khớp (tối đa 720 phút), `mfeR`/`maeR` (lời/lỗ xa nhất, theo high/low) và phút xảy ra,
  `tp1Min`, `exitMin`. 1R = |entry − SL ban đầu|.
- Monitor ghi tiếp mỗi phút (`ScalpSkillPaperService.logPath`). Lệnh chưa có log được dựng lại từ nến 1m Binance
  kể từ lúc khớp; báo cáo cũng tự backfill các lệnh đã đóng còn thiếu log.
- `GET /strategy-paper-trades/scalp-skill/time-stop-report` (`scalp-trade-path.ts`): mô phỏng time stop
  10′, 15′, 20′, 30′, 45′, 1h, 1h30, 2h, 3h, 4h và "không có". Quy tắc: nếu tới phút N chưa chạm TP1 và chưa đóng
  thì thoát ở `closeR[N-1]` (trừ phí 0.05%/chiều); còn lại giữ nguyên R thật. Trả về tổng R, R/lệnh, tỷ lệ thắng,
  số lệnh bị cắt, chênh lệch so với hiện tại, mốc tốt nhất, và trung vị thời gian tới TP1 / đóng lệnh, MFE, MAE.
- Trang Trading Analysis → chọn thẻ "Scalping Skill (AI)" để xem bảng "Nghiên cứu time stop" (mẫu n / 100).
