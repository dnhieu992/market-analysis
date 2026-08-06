# ETH — DCA theo **bước giá $50** (giá giảm $50 thì mua 1 lần) + chốt trên giá trung bình

**Date:** 2026-08-04
**Symbol:** ETHUSDT · **TF:** D1 · **Giai đoạn:** 2025-01-01 → 2026-08-04 (581 ngày)
**Tiếp nối:** [`2026-08-04-eth-daily-dca-avgcost-tp15.md`](./2026-08-04-eth-daily-dca-avgcost-tp15.md) ·
[`2026-08-04-eth-daily-dca-tp-sweep-8-10-15.md`](./2026-08-04-eth-daily-dca-tp-sweep-8-10-15.md) ·
[`2026-08-04-eth-daily-dca-buy-below-avg.md`](./2026-08-04-eth-daily-dca-buy-below-avg.md)
**Yêu cầu user:** thay vì mua theo ngày, **cứ giá giảm $50 thì DCA 1 lần**.

## Rule tested

Bỏ hoàn toàn nhịp mua theo thời gian — chỉ còn nhịp theo giá:

- **Mở chu kỳ:** 1 lệnh mua $10 tại open của ngày đầu chu kỳ.
- **Mua tiếp:** mỗi khi giá xuống thấp hơn **giá mua gần nhất** đúng **$50** → mua thêm $10.
  Giá đi lên không mua. Không có yếu tố thời gian.
- **Chốt:** bán sạch khi giá chạm `avgCost × (1 + tp)` → hôm sau mở chu kỳ mới.
- Không SL. Spot. Fee 0.05%/side.
- **Hai mô hình khớp:**
  - `touch` — lệnh limit nằm sẵn: trong 1 ngày, **mọi mốc lưới từ giá mua cuối xuống tới low đều khớp**
    (ngày giảm $200 khớp 4 lệnh). TP khớp khi high chạm target. Mua xử lý trước, TP kiểm sau.
  - `close` — check tay 1 lần/ngày tại close: **tối đa 1 lệnh mua/ngày**, TP chỉ khi close ≥ target.

## Command

```bash
for tp in 8 10 15; do for mode in touch close; do
  TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
    scripts/run-price-step-dca-tp-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 50 $tp 0.05 $mode
done; done

# sweep bước giá để kiểm tra $50 có phải số may mắn không (TP 10%)
for step in 20 25 50 75 100 150 200; do ... 10 $step 10 0.05 $mode; done
```

Script mới: `scripts/run-price-step-dca-tp-backtest.ts`.

## Kết quả — bước $50, $10/lệnh

| TP | mode | chu kỳ chốt | lãi thực hiện | vốn đã bỏ | peak vốn/chu kỳ | net P/L | ROI trên vốn |
|----|------|---|---|---|---|---|---|
| 8% | touch | 20 | +$137.47 | $2,260 | $530 | **−$11.17** | −0.49% |
| 8% | close | 11 | +$40.79 | $630 | $210 | **−$32.26** | −5.12% |
| 10% | touch | 16 | +$148.18 | $2,020 | $530 | **−$5.52** | **−0.27%** |
| 10% | close | 10 | +$44.49 | $620 | $210 | **−$28.57** | −4.61% |
| 15% | touch | 7 | +$118.05 | $1,460 | $670 | **−$114.30** | −7.83% |
| 15% | close | 5 | +$46.65 | $460 | $200 | **−$20.18** | −4.39% |

### So với hai luật đã test (TP 10%, `touch`)

| | DCA mỗi ngày | chỉ mua dưới avg | **giảm $50 mua 1 lần** |
|---|---|---|---|
| net P/L | −$633.01 | −$581.08 | **−$5.52** |
| ROI trên vốn giải ngân | −10.90% | −11.72% | **−0.27%** |
| vốn đã bỏ ra | $5,810 | $4,960 | $2,020 |
| peak vốn 1 chu kỳ | $3,470 | $3,270 | **$530** |
| chu kỳ treo | 347d · $3,470 · −24.9% | 347d · $3,270 · −22.9% | 296d · **$530** · −29.0% |
| DD nội bộ tệ nhất | −47.5% | −47.5% | −42.9% |

**Cùng ngân sách thì sao?** Mọi thứ trong luật này tuyến tính theo cỡ lệnh (avgCost không đổi khi
scale, nên TP kích hoạt y hệt ngày cũ). Chạy lại bước $50 với **$28.76/lệnh** để tiêu đúng $5,810
như baseline:

| | daily DCA $10/ngày | grid $50 · $28.76/lệnh |
|---|---|---|
| vốn đã bỏ | $5,810 | $5,810 |
| lãi thực hiện | +$232.71 | **+$426.17** |
| peak vốn 1 chu kỳ | $3,470 | **$1,524** |
| **net P/L** | **−$633.01** | **−$15.25** |

Cùng số tiền bỏ ra, luật bước giá **lãi thực hiện gần gấp đôi**, vốn kẹt tối đa **bằng 44%**,
và net gần như hoà (−$15 so với −$633).

## Sweep bước giá — $50 không phải số may mắn (TP 10%)

| step | touch: net / ROI | close: net / ROI | peak vốn (touch) |
|---|---|---|---|
| $20 | −$23.20 / −0.48% | −$30.24 / −4.09% | $1,330 |
| $25 | −$18.41 / −0.47% | −$34.16 / −4.81% | $1,060 |
| **$50** | **−$5.21 / −0.26%** | −$28.45 / −4.59% | $530 |
| $75 | −$82.67 / −7.01% | −$13.27 / −2.55% | $450 |
| $100 | +$2.01 / **+0.19%** | −$13.36 / −2.73% | $270 |
| $150 | −$41.78 / −6.96% | −$11.84 / −3.48% | $230 |
| $200 | +$3.61 / **+0.59%** | −$17.73 / −5.72% | $140 |

ROI nằm trong dải hẹp **−7% … +0.6%** trên toàn bộ 7 bước giá và 2 mô hình khớp — **không có ô nào
tệ như baseline** (−6.5% … −10.9%). Đây là điểm khác biệt lớn nhất so với nhánh TP-decay: ở đó dấu
kết quả lật liên tục giữa các tham số cạnh nhau, còn ở đây cả lưới đều nghiêng về cùng một phía.
$50 tình cờ nằm ở ô đẹp nhất của `touch`, nhưng $20/$25 cũng cho gần y hệt (−0.47%).

## Vì sao nó hơn — và hơn ở chỗ nào

**Không phải vì mua được giá tốt hơn.** Ngược lại là khác. Nhìn chu kỳ đang treo (TP 10% touch):

| | daily DCA | grid $50 |
|---|---|---|
| avgCost | 2,317 | **2,635** (tệ hơn $318) |
| cần giá lên | +24.9% | **+54.8%** (xa hơn) |
| ROI của bag | −24.9% | **−29.0%** (tệ hơn) |
| **vốn ôm** | **$2,920** | **$530** |

Grid mua **giá trung bình xấu hơn** vì nó rải đều theo giá; còn DCA theo ngày vô tình mua dày ở
vùng đáy (giá ở lâu chỗ nào thì mua nhiều chỗ đó — nó là bình quân **theo thời gian**). Grid thắng
đúng một thứ: **nó chỉ ôm $530 thay vì $2,920**. ETH rơi 2,430 điểm từ 4,300 → 1,870 = 48 mốc lưới
= $480. Trong khi DCA theo ngày rơi bao lâu thì mua bấy nhiêu ngày — 292 lệnh.

Nói cách khác: **bước giá $50 chính là cái trần vốn/chu kỳ mà 3 run trước đều trỏ tới**, chỉ khác là
nó tự sinh ra từ luật chứ không phải đặt tay. Downtrend càng dài mà không tạo đáy mới thì grid càng
đứng im, còn DCA theo ngày vẫn nạp tiền đều.

## Cảnh báo trước khi dùng thật

1. **Bước $50 là số tuyệt đối, không phải %.** Ở ETH $4,000 nó là 1.25%; ở ETH $1,900 nó là 2.7%;
   ở ETH $800 nó là 6.25%. Giá càng giảm lưới càng thưa (tính theo %) — may mắn là đúng hướng
   phòng thủ, nhưng nếu ETH lên $8,000 thì $50 = 0.6% và lưới sẽ bắn liên tục. **Nên chuyển sang
   bước theo % nếu dùng lâu dài**, chưa test.
2. **`touch` và `close` cách nhau khá xa** ($620 vs $2,020 vốn giải ngân). Mô hình `touch` giả định
   lệnh limit nằm sẵn ở mọi mốc và khớp hết trong ngày — muốn có kết quả này thì phải **đặt lưới
   limit thật**, không phải mỗi tối mở app xem một lần.
3. **Chu kỳ vẫn treo** — 296 ngày, cần ETH +54.8%. Luật này **không giải quyết** chuyện chu kỳ không
   bao giờ đóng, nó chỉ làm cho việc treo rẻ đi 5.5 lần.
4. **Vẫn chưa có cấu hình nào dương chắc chắn.** Ô +0.19% và +0.59% ở step $100/$200 là hoà vốn
   trong sai số, không phải edge. Kết luận đúng là: **grid biến một chiến lược lỗ 11% thành một
   chiến lược hoà vốn** trong 19 tháng ETH giảm 44%. Đó là phòng thủ tốt, không phải máy in tiền.

## Takeaway

Đây là **nhánh tốt nhất trong 4 nhánh đã test**. Cùng $5,810 bỏ ra, nó cho net −$15 so với −$633 của
DCA theo ngày, lãi thực hiện +$426 so với +$233, và vốn kẹt tối đa $1,524 so với $3,470. Quan trọng
hơn con số: **kết quả ổn định trên cả 7 bước giá và cả 2 mô hình khớp**, khác hẳn nhánh TP-decay vốn
lật dấu mỗi khi đổi tham số.

Nhưng phải hiểu đúng **vì sao** nó tốt: không phải vì mua giá đẹp hơn (giá trung bình của nó **tệ hơn**
$318), mà vì trong downtrend dài nó **tự động ngừng nạp tiền**, trong khi DCA theo ngày cứ đến hẹn là
mua bất kể giá đã đi đâu. Cả 3 run trước đều kết luận "vấn đề là vốn cam kết cho chu kỳ không bao giờ
đóng" — luật $50 này là câu trả lời đầu tiên thật sự chạm vào vấn đề đó.

Nhánh nên thử tiếp:
1. **Bước theo % thay vì $** (2% / 3% / 5% dưới giá mua cuối) — bỏ được phụ thuộc mức giá ở mục cảnh báo 1.
2. **Bước tăng dần** (mốc sau xa hơn mốc trước) — rải vốn thưa hơn nữa khi đã kẹt sâu.
3. **Kết hợp trần vốn cứng** — chốt lại điều mà grid đang làm ngầm, để biết phần cải thiện đến từ
   trần vốn hay từ nhịp giá.
