# Đánh giá lịch sử lệnh Bitget (live) — 2026-07-20 → 2026-09-10

**Date:** 2026-09-10
**Nguồn:** `bitget_trades` (status=closed), tức tab **Lịch sử & PnL** ở `/bitget` — lệnh thật đã khớp, không phải backtest
**Số lệnh:** 179 lệnh đóng trong ~52 ngày
**Fee:** đã trừ trong `netProfit` (phí thật của sàn). Funding cũng đã gộp.
**Vốn quy chiếu:** giả định $1000 (theo CLAUDE.md) để đọc % — vị thế thực tế rất nhỏ.

> Không có file đánh giá live nào trước đây; viết theo đúng format các bản `claude-backtest/runs/*.md`.
> Nếu bạn muốn để ở chỗ khác (vd `docs/`), báo mình chuyển.

## Tổng quan

| Chỉ số | Giá trị |
|---|---|
| Net PnL (sau phí) | **+$33.81** |
| Số lệnh | 179 (143 thắng / 36 thua / 0 hòa) |
| Win rate | **79.9%** |
| Profit Factor | **11.82** (gross win $36.94 / gross loss $3.13) |
| PnL TB/lệnh | +$0.189 |
| Lệnh thắng TB | +$0.26 (ROE +1.21%) |
| Lệnh thua TB | −$0.09 (ROE −0.44%) |
| Lãi lớn nhất / Lỗ lớn nhất | +$1.42 / −$0.42 |
| Tổng phí / funding | −$5.72 / −$1.07 |
| Max drawdown (trên net luỹ kế) | **−$0.53** |
| Thời gian giữ lệnh (giờ) | min 0.1 · median 6.8 · max **801.8** (~33 ngày) |

Quy ra vốn $1000: **+3.4% trong 52 ngày**, đường vốn gần như đi thẳng lên (DD tối đa chỉ −$0.53).

## Theo chiều lệnh

| Chiều | Số lệnh | Win rate | Net |
|---|---|---|---|
| **LONG** | 153 | 82.4% | **+$32.85** |
| SHORT | 26 | 65.4% | +$0.96 |

**Gần như toàn bộ lợi nhuận đến từ LONG.** Short chỉ đóng góp +$0.96/26 lệnh — không phải một nguồn edge, chỉ là hòa vốn có lãi mỏng.

## Theo coin (top/bottom)

| Coin | n | WR | Net |
|---|---|---|---|
| BTCUSDT | 31 | 77% | +5.62 |
| ETHUSDT | 23 | 83% | +3.97 |
| LINKUSDT | 23 | 83% | +3.85 |
| WLFIUSDT | 3 | 100% | +2.35 |
| ADAUSDT | 6 | 100% | +1.97 |
| … | | | |
| TAOUSDT | 2 | 0% | −0.09 |
| BIOUSDT | 1 | 0% | −0.08 |
| TIA/LTC/SOL | 2/2/4 | 50% | ~−0.05 mỗi coin |

BTC/ETH/LINK (77 lệnh, 43% số lệnh) tạo **~40%** tổng lãi. Các coin lỗ đều là mẫu rất nhỏ (1–4 lệnh) và lỗ không đáng kể → phần đuôi lỗ đang được cắt rất gọn.

## Phân bố giờ mở lệnh (UTC)

Lệnh mở rải khắp các giờ, **không chỉ 00:00** — nên đây không thuần tuý là bot auto-entry 00:00. Bucket 00:00 lớn nhất (20 lệnh, WR 90%, +$4.97) nhưng 03:00 (23 lệnh) và 07:00/14:00 cũng nhiều. Không có khung giờ nào âm rõ rệt.

## Nhận định thẳng thắn

**1. PF 11.8 / WR 80% đẹp một cách đáng ngờ — đây là chữ ký của "TP nhỏ cố định, không cắt lỗ cứng".** Lệnh thắng bị chốt ở TP ~2% (ROE thắng TB chỉ +1.21%), lệnh thua thì còn nhỏ hơn (−0.44%). Cả thắng lẫn thua đều bé → kiểu "nhặt bạc lẻ". Winrate cao vì lệnh ngược hướng **được ôm rất lâu** thay vì cắt: có lệnh giữ tới **801 giờ (~33 ngày)** để chờ về TP.

**2. Đường vốn quá mượt (max DD −$0.53) là do chưa gặp cú đảo chiều lớn, không phải do hệ thống không có rủi ro.** Bias LONG mạnh + ôm lệnh lỗ chờ hồi → trong một giai đoạn thị trường đi ngang/tăng (7–9/2026) thì gần như lệnh nào cũng cuối cùng cũng xanh. Rủi ro đuôi (một xu hướng giảm dài kẹp vị thế long ôm 33 ngày) **chưa xuất hiện trong cửa sổ 52 ngày này** — nó bị giấu chứ chưa bị loại.

**3. Đối chiếu kỳ vọng cũ:** memory ghi bot /bitget được dựng khi đã biết **PF backtest = 0.83** (kỳ vọng âm). Live lại ra PF 11.8. Chênh lệch này **không nên hiểu là edge thật** — nó khớp đúng với cảnh báo cũ rằng lợi thế mong manh, phụ thuộc regime: kết quả đẹp đến từ (a) tape thuận cho long 2% nhanh và (b) cơ chế ôm lệnh thua tới khi xanh. Đổi regime (giảm sâu, kéo dài) thì chính hai yếu tố đó đảo thành lỗ lớn.

**4. Quy mô còn rất nhỏ.** +$0.19/lệnh, tổng +$33.81. Là bằng chứng khái niệm tốt, nhưng chưa phải quy mô để kết luận về khả năng chịu đựng vốn.

## Khuyến nghị

- **Đừng dùng PF 11.8 làm kỳ vọng tương lai.** Con số thật cần đo là: điều gì xảy ra với các vị thế long bị ôm >7 ngày khi thị trường giảm 15–20%. Đó là nơi toàn bộ rủi ro đang nằm.
- Nếu muốn giữ style này, cân nhắc **một mức cắt lỗ cứng theo thời gian hoặc theo % ** cho các lệnh ôm quá lâu, để biến rủi ro đuôi ẩn thành chi phí đo được — chấp nhận WR giảm để tránh một cú lỗ nuốt cả tháng lãi.
- Short chưa tạo giá trị (+$0.96/26 lệnh); có thể tắt short hoặc siết điều kiện vào short lại.

**Phạm vi:** chỉ 52 ngày, một regime (đi ngang/tăng), vị thế nhỏ. Mọi kết luận tích cực ở trên đều gắn chặt với việc chưa gặp downtrend kéo dài trong cửa sổ này.
