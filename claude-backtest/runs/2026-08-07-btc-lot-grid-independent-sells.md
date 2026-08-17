# BTC — Grid mỗi lô một lệnh bán riêng (mua khi giảm X%, bán từng lô ở +Y%)

**Date:** 2026-08-07 · **Symbol:** BTC/USD (Bitstamp daily)
**Cửa sổ:** CHOP 2022-01-01 → 2026-08-07 (4.60y) · BULL 2017-01-01 → 2021-12-31 (5.00y)
**Tiếp nối:** [`2026-08-07-btc-seasonal-dca-exit-rules.md`](./2026-08-07-btc-seasonal-dca-exit-rules.md)
**Yêu cầu user:** bỏ kiểu gom-qua-tháng; "giá tăng vài % thì bán dần, giảm thì mua lại, đảo liên
tục", mỗi túi giữ **lệnh bán riêng của nó**.

> Khác hẳn 2 run grid trên ETH ngày 2026-08-04
> ([`price-step-grid`](./2026-08-04-eth-price-step-grid-dca.md),
> [`grid-then-daily-hybrid`](./2026-08-04-eth-grid-then-daily-hybrid.md)): những run đó bán **sạch
> kho** tại `avgCost × (1+tp)`. Ở đây mỗi lô độc lập — lô mua ở P bán ở `P × (1+Y)`, không quan tâm
> phần kho còn lại. Lô sâu cứ nằm chờ giá về đúng mức của nó.

## Luật

- **MUA** 1 lô khi giá giảm **X%** so với đỉnh chạy kể từ lần mua cuối. Sau mỗi lần mua, mốc tham
  chiếu reset về giá mua đó → tự khởi động lại, không cần lịch tháng, không cần anchor.
- **BÁN** từng lô tại **giá mua của chính lô đó × (1+Y%)**.
- Cỡ lô = vốn / `maxLots`. Hết lô hoặc hết tiền thì ngừng mua. Không SL. Spot. Fee 0.05%/side.
- **Lô mua hôm nay không được bán hôm nay** — chặt hơn run ETH cũ (chúng xử lý mua trước rồi check
  TP ngay trên cùng cây nến).

**Hai mô hình khớp**, khác biệt rất lớn nên phải test cả hai:
- `touch` — lệnh limit **nằm sẵn trên sàn**: mọi mốc lưới từ tham chiếu xuống tới low đều khớp trong
  ngày; lô nào có target dưới high thì khớp.
- `close` — **check tay 1 lần/ngày** tại close: tối đa 1 lệnh mua và 1 lệnh bán mỗi ngày.

## Commands

```bash
# quét X × Y × độ sâu lưới
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-lot-grid-backtest.ts 2022-01-01 2000 0.05 2100-01-01 touch

# bảng bền vững: 2 regime × 2 mô hình khớp
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-lot-grid-robustness.ts 2000 0.05

# lô đang mở của config được chọn
GRID_DETAIL=3,5,20 TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-lot-grid-backtest.ts 2022-01-01 2000 0.05
```

## Bảng bền vững — $2,000, chọn theo ô TỆ NHẤT chứ không theo ô đẹp nhất

B&H: CHOP **+39.5%** (maxDD −67.9%) · BULL **+4,680%** (maxDD −84.1%)

| X/Y/lô | cỡ lô | chop touch | DD | chop close | DD | bull touch | DD | bull close | DD | **tệ nhất** | flip/năm |
|--------|-------|-----------|----|-----------| ---|-----------|----|-----------|----|------------|----------|
| **3/5/20** | **$100** | **+57.3%** | −53 | **+54.4%** | −28 | **+191.6%** | −35 | **+112.5%** | −39 | **9.9%/y** | 87 |
| 3/5/10 | $200 | +55.3% | −61 | +53.0% | −51 | +256.3% | −31 | +136.0% | −45 | 9.7%/y | 44 |
| 3/7/20 | $100 | +62.8% | −54 | +50.1% | −43 | +236.8% | −32 | +117.3% | −40 | 9.2%/y | 67 |
| 5/10/20 | $100 | +61.6% | −51 | +43.8% | −36 | +231.6% | −32 | +114.0% | −43 | 8.2%/y | 44 |
| 5/10/10 | $200 | +69.6% | −56 | +41.1% | −53 | +313.8% | −26 | +127.6% | −46 | 7.8%/y | 25 |
| 3/5/30 | $67 | +59.8% | −53 | +36.7% | −19 | +154.2% | −40 | +84.9% | −35 | 7.0%/y | 127 |
| 5/7/20 | $100 | +63.3% | −49 | +35.8% | −27 | +188.1% | −38 | +98.3% | −39 | 6.9%/y | 61 |
| 7/10/20 | $100 | +66.3% | −43 | +34.6% | −21 | +201.8% | −34 | +94.0% | −31 | 6.7%/y | 39 |
| 5/5/20 | $100 | +68.8% | −43 | +25.4% | −17 | +157.7% | −42 | +84.1% | −31 | 5.0%/y | 82 |
| 5/7/40 | $50 | +66.0% | −30 | +17.9% | −14 | +153.0% | −37 | +52.7% | −23 | 3.6%/y | 106 |
| 5/5/30 | $67 | +65.8% | −28 | +16.9% | −12 | +144.3% | −39 | +56.3% | −22 | 3.5%/y | 109 |

Ô đẹp nhất bảng là 5/10/10 trong bull (+313.8%) nhưng nó chỉ giữ được 7.8%/y ở ô tệ nhất. Chọn theo
cột tệ nhất thì **3% mua / 5% bán / 20 lô $100** thắng.

### `touch` vs `close` — khác biệt sống còn

Lưới càng sâu, `close` càng sập: 5/5/30 rơi từ +65.8% xuống +16.9%, 5/7/40 từ +66.0% xuống +17.9%.
Lý do đơn giản: `close` chỉ cho 1 lệnh mua/ngày nên lưới sâu **không bao giờ giải ngân kịp**.

Kết luận vận hành: **chiến lược này bắt buộc phải đặt lệnh limit nằm sẵn trên sàn.** Nếu định mỗi
ngày mở app xem một lần rồi bấm tay, chỉ có lưới nông (10–20 lô) mới còn ăn được.

## So với hai chiến lược đã test

| | grid 3/5/20 | mùa vụ May/Jun/Aug/Dec TP6 | B&H |
|---|---|---|---|
| CHOP 2022–26 | **+57.3%** | +51.3% | +39.5% |
| BULL 2017–21 | **+191.6%** | +53.1% | +4,680% |
| maxDD chop | −53% | −42.6% | −67.9% |

Grid là chiến lược đầu tiên trong loạt này **thắng ở cả hai regime**. Lọc mùa vụ chỉ ăn được ở chop
(bull nó tụt xuống +53%); grid tự thích nghi vì nhịp mua bám theo giá chứ không bám theo lịch.

Nhưng trong bull thật thì grid vẫn **thua B&H rất xa** (+191% vs +4,680%) — nó bán hàng đi trên
đường lên. Đó là bản chất của grid, không sửa được bằng tham số.

## Trạng thái hôm nay — chỗ chiến lược đang đau

Chạy 3/5/20 tới 2026-08-07, giá đóng cửa 64,522:

```
20/20 lô ĐANG MỞ · $2,000 giải ngân hết · $1,948 tiền mặt (là lãi đã chốt)
```

| mua ngày | giá vào | bán tại | so với giá nay | đã ôm |
|----------|---------|---------|----------------|-------|
| 2025-11-16 | 93,834 | 98,526 | **−34.5%** | 264d |
| 2026-01-16 | 95,001 | 99,751 | −35.3% | 203d |
| 2025-11-11 | 104,241 | 109,453 | −41.1% | 269d |
| 2025-10-26 | 111,658 | 117,241 | −45.0% | 285d |
| 2025-10-09 | 120,493 | 126,518 | −49.0% | 302d |
| 2025-08-14 | 120,781 | 126,821 | −49.1% | **358d** |
| 2025-10-07 | 122,484 | **128,608** | **−49.8%** | 304d |

**Lưới đã bắn hết đạn trong cú sập tháng 10–11/2025 và kẹt từ đó tới nay.** Lô sâu nhất cần BTC về
**128,608** mới đóng được — tức là +99% từ giá hiện tại.

Đây chính là **rủi ro khoá vốn của run trước quay lại, chỉ đổi hình dạng**: thay vì 1 túi kẹt 292
ngày thì giờ là 20 lô kẹt 200–358 ngày. Grid **không xoá được** rủi ro đó, nó chỉ chia nhỏ ra.

Điểm khác biệt có lợi: $1,948 lãi đã **chốt thành tiền mặt thật** trong 4.6 năm, không phải lãi trên
giấy. Chiến lược mùa vụ cùng kỳ chỉ chốt được $1,026 và cũng đang ôm 2 túi lỗ.

## Takeaway

Config chọn: **mua thêm 1 lô $100 mỗi khi giá giảm 3% so với đỉnh gần nhất kể từ lần mua trước;
mỗi lô đặt sẵn lệnh bán ở +5% trên giá mua của chính nó; tối đa 20 lô ($2,000).**
Khoảng 87 vòng/năm, ~$4.9 lãi ròng mỗi vòng sau phí.

Ba điều phải nhớ:

1. **Phải đặt limit nằm sẵn trên sàn.** Check tay 1 lần/ngày làm mọi lưới sâu hơn 20 lô mất 2/3
   lợi nhuận.
2. **Grid thắng chop, thua bull.** Nó ăn đứt lọc mùa vụ ở cả hai regime, nhưng nếu BTC vào sóng lớn
   thì B&H vẫn bỏ xa (+4,680% vs +191%).
3. **Hết đạn là kẹt.** Hôm nay lưới đang 20/20 lô, lô sâu nhất cần +99% mới đóng. maxDD −53% ở chop
   còn **tệ hơn** chiến lược mùa vụ (−42.6%).

**Chưa test** (bước tiếp theo rõ ràng nhất): dồn $1,948 lãi đã chốt trở lại lưới — hoặc tăng cỡ lô
theo vốn, hoặc nới `maxLots` khi tiền mặt tăng. Mô hình hiện tại cố định lô $100 và để lãi nằm chết
dưới dạng tiền mặt, nên mọi con số trên đây là **kịch bản thận trọng**. Cũng chưa test: giãn bước
mua khi xuống sâu (3% → 5% → 8%) để đạn bền hơn trong cú sập.
