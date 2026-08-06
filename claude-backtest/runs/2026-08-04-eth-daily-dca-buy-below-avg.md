# ETH — DCA $10/ngày + luật mới: **chỉ mua khi giá thấp hơn giá trung bình**

**Date:** 2026-08-04
**Symbol:** ETHUSDT · **TF:** D1 · **Giai đoạn:** 2025-01-01 → 2026-08-04 (581 ngày)
**Tiếp nối:** [`2026-08-04-eth-daily-dca-avgcost-tp15.md`](./2026-08-04-eth-daily-dca-avgcost-tp15.md) ·
[`2026-08-04-eth-daily-dca-tp-sweep-8-10-15.md`](./2026-08-04-eth-daily-dca-tp-sweep-8-10-15.md)
**Yêu cầu user:** chạy lại backtest ETH lúc nãy, thêm 1 luật — **chỉ mua khi giá đang thấp hơn giá trung bình hiện tại**.

## Rule tested

Giống baseline, chỉ thêm 1 cửa lọc ở bước mua:

- **Mua:** $10 tại **open** nến ngày, **chỉ khi `open < avgCost`** của bag đang giữ.
  Lệnh mua **đầu tiên của mỗi chu kỳ luôn khớp** (chưa có giá trung bình để so).
- **Không mua** → tiền $10 hôm đó **không giải ngân** (nằm lại ví).
- **Chốt:** bán sạch khi giá chạm `avgCost × (1 + tp)` → hôm sau mở chu kỳ mới, avgCost về 0.
- Không SL. Spot. Fee 0.05%/side. Quét `tp` = 8 / 10 / 15%, cả `touch` và `close`.

## Command

```bash
# luật mới
for tp in 8 10 15; do for mode in touch close; do
  TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
    scripts/run-daily-dca-belowavg-tp-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 $tp 0.05 $mode below
done; done

# baseline chạy lại trong cùng session (tham số cuối = "all" → tắt cửa lọc)
... scripts/run-daily-dca-belowavg-tp-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 $tp 0.05 $mode all
```

Script mới: `scripts/run-daily-dca-belowavg-tp-backtest.ts` (cờ `below` / `all`).
Baseline chạy lại khớp **chính xác từng cent** với run cũ (+$222.49 / +$307.94 / +$232.71 /
+$324.59 / +$330.23 / +$369.05), chỉ lệch vài đô ở net P/L vì nến 2026-08-04 còn đang chạy.

## Bảng so sánh — 6 kịch bản

| TP | mode | | chu kỳ chốt | lãi thực hiện | vốn đã bỏ ra | peak vốn/chu kỳ | **net P/L** |
|----|------|---|---|---|---|---|---|
| 8% | touch | baseline | 13 | +$222.49 | $5,810 | $3,010 | **−$378.93** |
| | | **chỉ mua dưới avg** | 16 | +$168.46 | $5,040 | $2,920 | **−$392.52** |
| 8% | close | baseline | 7 | +$307.94 | $5,810 | $3,470 | **−$557.78** |
| | | **chỉ mua dưới avg** | 13 | +$190.65 | $4,880 | $2,920 | **−$370.33** |
| 10% | touch | baseline | 8 | +$232.71 | $5,810 | $3,470 | **−$633.01** |
| | | **chỉ mua dưới avg** | 12 | +$168.07 | $4,960 | $3,270 | **−$581.08** |
| 10% | close | baseline | 6 | +$324.59 | $5,810 | $3,470 | **−$541.15** |
| | | **chỉ mua dưới avg** | 10 | +$300.26 | $4,930 | $3,270 | **−$448.88** |
| 15% | touch | baseline | 4 | +$330.23 | $5,810 | $3,600 | **−$604.93** |
| | | **chỉ mua dưới avg** | 7 | +$234.60 | $4,840 | $3,270 | **−$514.84** |
| 15% | close | baseline | 4 | +$369.05 | $5,810 | $3,570 | **−$549.19** |
| | | **chỉ mua dưới avg** | 5 | +$284.00 | $4,560 | $3,260 | **−$458.42** |

### Hai cách đọc, ra hai kết luận ngược nhau

**Cách 1 — cùng ngân sách $10/ngày, ngày nào không mua thì tiền nằm ví** (thực tế nhất):
so net P/L bằng đô. Luật mới **thắng 5/6 kịch bản**, đỡ lỗ trung bình **+$87**
(tốt nhất TP 8% `close`: −$558 → −$370, đỡ $187). Chỉ thua ở TP 8% `touch` (−$14).

**Cách 2 — tính lợi suất trên đúng số tiền đã giải ngân** (`net / vốn đã bỏ ra`):

| TP / mode | baseline | chỉ mua dưới avg |
|---|---|---|
| 8% touch | −6.52% | **−7.79%** |
| 8% close | −9.60% | **−7.59%** |
| 10% touch | −10.90% | **−11.72%** |
| 10% close | −9.31% | **−9.11%** |
| 15% touch | −10.50% | **−10.64%** |
| 15% close | −9.54% | **−10.05%** |

Ở thước đo này luật mới **thua 4/6**. Nghĩa là: phần "đỡ lỗ" ở cách 1 **gần như toàn bộ đến từ
việc giải ngân ít tiền hơn** ($4.6k–5.0k thay vì $5.8k), chứ không phải từ chất lượng giá mua tốt hơn.

## Vì sao luật này gần như không đổi được gì

**Cửa lọc hầu như luôn mở.** Tỉ lệ khớp lệnh mua: **78–87%** trên 581 ngày. Trong downtrend,
giá gần như luôn nằm dưới giá trung bình → điều kiện "mua khi thấp hơn avg" thoả gần hết ngày.

Nhìn thẳng vào chu kỳ đang treo — thứ quyết định toàn bộ kết quả (TP 15% `touch`):

| | baseline | chỉ mua dưới avg |
|---|---|---|
| chu kỳ mở | 2025-08-10, 360 ngày | 2025-08-23, 347 ngày |
| lệnh mua / bỏ qua | 360 / 0 | **327 / 20** (94% vẫn mua) |
| vốn ôm | $3,600 | $3,270 |
| avgCost | 2,533.59 | 2,427.73 |
| cần giá | 2,913.63 (+55.7%) | 2,791.89 (**+49.2%**) |
| lỗ tạm tính | −$935 (−26.0%) | −$749 (−22.9%) |
| DD tệ nhất | −49.9% | −47.5% |

Trong 347 ngày kẹt hàng, cửa lọc chỉ chặn được **20 lệnh**. Nó kéo avgCost từ 2,534 xuống 2,428
và hạ ngưỡng thoát từ +55.7% xuống +49.2% — nhẹ hơn, nhưng **vẫn là con số không thể với tới**.
Bag vẫn treo, vẫn ôm $3.27k, vẫn âm 23%.

Mặt khác, cửa lọc **cắn đúng vào các chu kỳ thắng**: nó chặn mua trong các nhịp hồi — mà nhịp hồi
chính là lúc chu kỳ sắp chốt lời. Kết quả là lãi thực hiện tụt ở **cả 6 kịch bản**
(TP 15% touch: +$330 → +$235; TP 8% touch: +$222 → +$168), dù số chu kỳ chốt lại **tăng**
(4 → 7, 13 → 16). Nhiều chu kỳ hơn nhưng mỗi chu kỳ ôm ít hàng hơn nên ăn ít hơn.

## Takeaway

Luật "chỉ mua khi giá dưới giá trung bình" **có cải thiện, nhưng cải thiện sai chỗ và quá nhỏ**.
Tính bằng đô nó đỡ lỗ ~$87/kịch bản, nhưng bóc ra thì gần hết phần đỡ đó chỉ là **tiêu ít tiền hơn**
— tính lợi suất trên vốn thực giải ngân, nó còn thua baseline ở 4/6 cấu hình. Cả 6 cấu hình vẫn âm,
không có cấu hình nào lật được dấu.

Lý do rất cơ học: cửa lọc so giá với **giá trung bình của chính mình**, mà trong downtrend giá luôn
nằm dưới giá trung bình → cửa mở 78–87% thời gian, và **94% trong chính chu kỳ đang kẹt**. Nó không
phải bộ lọc xu hướng; nó chỉ là bộ lọc "đừng mua đuổi trong nhịp hồi". Nhịp hồi lại đúng là lúc chu kỳ
sắp chốt lời, nên thứ nó chặn hiệu quả nhất lại là **những lệnh mua sinh lãi**.

Chỗ duy nhất nó thật sự hữu ích: **peak vốn/chu kỳ giảm** ($3,600 → $3,270) và DD nội bộ nhẹ hơn
(−49.9% → −47.5%). Cùng hướng với kết luận của nhánh TP-decay: thứ cải thiện được luật này là
**kiểm soát vốn cam kết cho một chu kỳ**, không phải tinh chỉnh điều kiện mua hay mức chốt.

Nhánh nên thử tiếp, theo thứ tự đáng giá:
1. **Trần vốn/chu kỳ** — chạm trần thì ngừng mua (nhánh 1 chưa test, được cả 3 run trỏ tới).
2. **Gate sâu hơn**: chỉ mua khi `giá < avgCost × (1 − x)` với x = 3/5/10% — ép cửa lọc thật sự đóng
   thay vì mở 85% thời gian.
3. **Lọc xu hướng thật** (vd chỉ DCA khi ETH trên EMA tuần) — cái mà luật này *trông giống* nhưng không phải.
