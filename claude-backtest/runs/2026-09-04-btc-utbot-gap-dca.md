# DCA BTC theo tín hiệu gap UTBot — có hơn DCA đều không?

**Date:** 2026-09-04
**Symbol:** BTCUSDT spot, 1d
**Window:** 2018-01-01 → 2026-09-04 (3.169 ngày)
**Dòng tiền:** nạp **$200/tháng** (tổng $21.000), long-only, **KHÔNG BÁN** — DCA tích luỹ dài hạn
**Fee:** 0.05%/side. Không tính slippage.
**Indicator:** UTBot = Wilder ATR(10), keyValue 2 (mặc định), `gap% = (stop − close) / close × 100` khi bear

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-utbot-gap-dca-backtest.ts BTCUSDT 2018-01-01 200 0.05 2
```

Script: `scripts/run-btc-utbot-gap-dca-backtest.ts`

## Giả thuyết được kiểm tra

Từ `2026-09-03-utbot-gap-bounce-stats.md`: gap ≥ 12% (kv=2) cho P(hồi ≥5% trong 10 ngày) = 82%
so với 47% ở nhóm gap 4-6%. Câu hỏi: biến quan sát đó thành luật giải ngân DCA thì có thắng
được DCA đều đặn không?

Mọi chiến lược nhận **cùng một dòng tiền vào**, khác nhau duy nhất ở luật giải ngân. Tiền chưa
giải ngân nằm ở dạng cash và **được tính vào giá trị cuối** — không giấu cash drag bằng cách
chỉ khoe avgCost.

| Chiến lược | Luật |
|---|---|
| **MONTHLY** | mua hết tiền tháng vào ngày 1 — mốc so sánh |
| DAILY | chia đều mua mỗi ngày |
| TIERED | mua mỗi ngày; gap 8-12% mua x2; gap ≥12% mua x3 |
| WAIT | dồn tiền mặt, giải ngân toàn bộ khi gap ≥12% |
| WAIT+FS | như WAIT, thêm failsafe 6 tháng |
| RES-DD | để dành 50%, bắn hết khi giảm ≥30% từ đỉnh |
| RES-GAP | để dành 50%, bắn hết khi gap ≥12% |
| EMA200 | mua x2 khi giá dưới EMA200 |
| DDTIER | nhân theo mức giảm từ đỉnh: <10%=1x, 10-30%=1.5x, 30-50%=2x, >50%=3x |
| DIPONLY | **đối chứng không dùng UTBot**: mua hết khi giá ≤ đỉnh 30d −15% |

## Kết quả — toàn giai đoạn

| Chiến lược | giá trị cuối | lãi % | BTC | giá TB | cash nằm không | maxDD | **vs MONTHLY** |
|---|---|---|---|---|---|---|---|
| **MONTHLY** | **$104,789** | 398.8% | 1.2989 | $16,168 | 0% | 74.7% | — |
| TIERED | $104,966 | 399.6% | 1.2989 | $16,034 | 1% | 74.6% | **+$177 (+0.2%)** |
| DAILY | $104,665 | 398.4% | 1.2957 | $16,073 | 2% | 74.6% | −$83 |
| EMA200 | $104,670 | 398.4% | 1.2958 | $16,073 | 2% | 74.7% | −$78 |
| DDTIER | $104,500 | 397.6% | 1.2940 | $16,115 | 1% | 74.7% | −$247 |
| RES-GAP | $104,376 | 397.0% | 1.2845 | $15,736 | 3% | 74.4% | −$372 |
| RES-DD | $104,283 | 396.6% | 1.2921 | $16,186 | 2% | 74.6% | −$465 |
| WAIT | $104,086 | 395.6% | 1.2733 | $15,393 | 4% | 74.2% | −$662 |
| DIPONLY | $99,567 | 374.1% | 1.2297 | $16,752 | 1% | 74.5% | −$5,181 |
| WAIT+FS | $96,504 | 359.5% | 1.1942 | $17,418 | 4% | 74.0% | −$8,244 |

Toàn bộ nhóm "luôn giải ngân" nằm trong khoảng **±0.5%** quanh MONTHLY trên 8.7 năm. Nhóm
"chờ tín hiệu rồi mới mua" thua từ −0.6% tới −7.9%.

## Quét ngưỡng gap (giá trị cuối)

| ngưỡng | TIERED | WAIT | WAIT+FS |
|---|---|---|---|
| ≥6% | $104,375 | $101,603 | $101,603 |
| ≥8% | $104,597 | $99,025 | $99,453 |
| ≥10% | $104,608 | $96,578 | $98,036 |
| ≥12% | $104,966 | $104,127 | $96,542 |
| ≥15% | $105,276 | $99,518 | $98,364 |
| ≥20% | $105,269 | **$107,059** | $99,694 |

Không có xu hướng đơn điệu. WAIT nhảy $96.5k → $104.1k → $99.5k → $107.1k khi ngưỡng đi từ
10% lên 20% — đó là nhiễu, không phải đường cong tham số.

## Out-of-sample: cùng luật, 3 giai đoạn tách rời (chênh lệch vs MONTHLY)

| Chiến lược | 2018-2020 | 2021-2023 | 2024-2026 | Ổn định? |
|---|---|---|---|---|
| TIERED | +$127 | −$23 | −$134 | ⚠️ đổi dấu |
| DAILY | +$17 | +$11 | −$150 | ⚠️ đổi dấu |
| EMA200 | +$35 | −$37 | −$106 | ⚠️ đổi dấu |
| DDTIER | −$36 | −$33 | −$86 | ❌ âm cả 3 |
| RES-GAP | +$93 | −$455 | +$309 | ❌ nhảy loạn |
| RES-DD | −$107 | +$33 | −$203 | ❌ nhảy loạn |
| **WAIT** | +$169 | **−$922** | **+$768** | ❌ phương sai khổng lồ |
| DIPONLY | −$1,907 | +$250 | −$59 | ❌ âm nặng |

Không chiến lược nào giữ được dấu dương qua cả 3 giai đoạn.

## Độ nhạy keyValue (TIERED, ngưỡng 12%)

| kv | giá trị cuối |
|---|---|
| 1 | $104,882 |
| 2 | $104,966 |
| 3 | $104,160 |

Chênh lệch 0.8% giữa ba thiết lập — tức tín hiệu gần như không tác động tới kết quả.

## Takeaway

**Câu trả lời: không. Gap UTBot không cải thiện được DCA BTC.** Biến thể tốt nhất (TIERED,
ngưỡng 12%) hơn DCA đều đúng **+$177 trên $21.000 nạp vào sau 8.7 năm = +0.17%** — nhỏ hơn
chênh lệch giữa hai lần chạy do giá đóng cửa hôm nay thay đổi, và đổi dấu ở giai đoạn OOS
2024-2026.

**Phát hiện cấu trúc quan trọng nhất — vì sao mọi overlay đều vô hiệu:** khi bạn đã giải ngân
hết tiền hàng tháng, luật "gap rộng thì mua x2/x3" **không mua được nhiều hơn**, nó chỉ dời
thời điểm mua trong phạm vi cùng tháng đó. Muốn timing tác động thật thì phải để dành tiền
(RES-DD, RES-GAP) — nhưng khi để dành thì cash drag ăn hết phần lợi: RES-GAP có giá TB thấp
nhất nhóm ($15,736 so với $16,168 của MONTHLY, tức **mua rẻ hơn 2.7%**) mà giá trị cuối vẫn
thua $372, vì 3% vốn nằm không suốt 8.7 năm trong một tài sản tăng 400%.

**Đây là cái bẫy cốt lõi của mọi ý tưởng "chờ mua đáy" trên tài sản xu hướng tăng dài hạn:**
mua rẻ hơn 2.7% không bù được việc vào thị trường muộn hơn.

**WAIT là bài học rõ nhất về phương sai.** Nó thắng lớn nhất (+$768 ở 2024-2026) và thua lớn
nhất (−$922 ở 2021-2023) trong cùng một bảng. Với 6-36 lần mua trong cả giai đoạn, kết quả
phụ thuộc vào việc vài lần giải ngân đó rơi trúng chỗ nào — không phải edge.

**DIPONLY (đối chứng, không dùng UTBot) thua $5,181** cho thấy vấn đề không nằm ở chỗ chọn sai
chỉ báo. Mọi luật "chờ giá giảm sâu rồi mới mua" đều thua trên BTC 2018-2026, vì có những
giai đoạn dài giá không bao giờ giảm đủ sâu để kích hoạt.

**Khuyến nghị:** DCA đều đặn hàng tháng, mua và không bán. Nếu muốn dùng gap thì chỉ ở dạng
TIERED (luôn mua, gap rộng thì mua nhiều hơn trong cùng số tiền tháng đó) — nó vô hại và về
mặt tâm lý dễ theo hơn, nhưng đừng kỳ vọng nó tạo ra lợi thế đo được.

**Lưu ý phạm vi:** chỉ test BTC, chỉ 2018-2026 — một giai đoạn BTC tăng ~400% so với vốn nạp
đều. Kết luận "đừng chờ" gắn chặt với việc tài sản này có xu hướng tăng dài hạn. Trên tài sản
đi ngang hoặc giảm, thứ tự có thể đảo ngược.
