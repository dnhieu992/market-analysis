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
