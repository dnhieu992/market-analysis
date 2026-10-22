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
