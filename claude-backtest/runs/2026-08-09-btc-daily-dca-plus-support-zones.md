# BTC — DCA theo ngày CỘNG mua tại vùng hỗ trợ cứng

**Date:** 2026-08-09 · **Symbol:** BTC/USD (Bitstamp daily) · **Fee:** 0.05%/side
**Yêu cầu user:** "trade BTC bằng DCA, vừa mua theo ngày vừa mua tại các vùng hỗ trợ cứng" —
kèm phân tích portfolio BTC thật đang có.
**Script mới:** `scripts/run-btc-daily-plus-support-dca.ts`
**Liên quan:** [`2026-07-26-dca-ladder-support-zone-vs-fixed.md`](./2026-07-26-dca-ladder-support-zone-vs-fixed.md) ·
[`2026-08-04-eth-daily-dca-buy-below-avg.md`](./2026-08-04-eth-daily-dca-buy-below-avg.md) ·
[`2026-08-07-btc-lot-grid-independent-sells.md`](./2026-08-07-btc-lot-grid-independent-sells.md)

## Portfolio BTC thật (DB `market_analysis`, 2026-08-09)

| | |
|---|---|
| Sleeve | `BTC&ETH(70%)` — vốn kế hoạch **$2,800** |
| BTC đang giữ | **0.02808232 BTC**, giá vốn **$63,899**, cost **$1,794.43** |
| MTM @ $65,258 | $1,832.60 → **+2.13%** chưa chốt |
| Realized BTC | **+$75.44** |
| ETH cùng sleeve | $386.53 cost → sleeve đã dùng $2,181 / $2,800 → **còn ~$619 (22%)** |
| Lịch sử | 102 lệnh mua ($2,452), 23 lệnh bán ($733), ticket TB **$24** |
| Nhịp mua theo tháng | 03: $425 · 05: $177 · **06: $1,425 (66 lệnh, 58% cả ngân sách)** · 07: $381 · 08: $45 |
| Giá mua TB theo tháng | 06: $62,802 · 07: $63,421 · **08: $63,703** (mua gần nhất $64,978, **trên** giá vốn) |
| USDT rảnh trong ledger | Spot $3,302 · Trading $1,138 · Bitget $100 · MEXC $50 |

Đọc ra: DCA hiện tại **không có quỹ dự trữ**. Tháng 6 sập, mua rất tốt vùng $58–62k nhưng
tiêu hết 58% ngân sách trong một tháng; giờ giá vốn $63,899 ≈ spot, chỉ còn 22% đạn.

## Cấu trúc giá BTC (2026-08-09, close $65,240)

- Đỉnh 900d **$126,200** (2025-10-06) → **−48.3%**. EMA50 **$64,695** · EMA100 **$66,916** · EMA200 **$72,312** → dưới cả EMA100/200.
- Volume profile 400d: node dày nhất **$62k–66k** — giá đang nằm giữa vùng tích luỹ, không phải hỗ trợ.
- Đáy swing tuần dưới giá: **$62,510** (02-23) · **$60,000** (02-02) · **$59,131** (06-01) · **$57,800** (06-29).
- Dưới $57.8k volume **mỏng hẳn** ($56–58k: 588k BTC vs $64–66k: 1,784k) → hố khí tới ~$50k, kệ dày kế tiếp **$42–44k**.
- Xác suất chạm từ 1 ngày bất kỳ (900d): −5% trong 30d **70%** · −10% trong 30d **43%** / 90d **72%** · −20% trong 90d **44%**.

## Luật backtest

Ngân sách $200/tháng chia hai chân:
- **DAILY** — `dailyShare` × ngân sách, rải đều mỗi ngày, mua tại close.
- **DIP** — phần còn lại **không tiêu**, cộng dồn vào reserve, chỉ bắn khi chạm hỗ trợ.
  Ticket dip = 4× ticket ngày. Hai định nghĩa hỗ trợ:
  - `fixed` — giảm X% so với đỉnh chạy kể từ lần mua dip cuối (tự reset, không lookahead).
  - `zone` — cụm pivot-low xác nhận trước ngày giao dịch, tol 3%, ≥2 chạm, cooldown 20 ngày.
- **cap 3m** — reserve trần 3 tháng ngân sách; phần tràn chảy ngược vào lệnh mua ngày (chống tiền chết).
- Không SL, không bán (bảng A). Bảng B thêm chốt sạch kho tại `avgCost × (1+tp)`.

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-daily-plus-support-dca.ts 2022-01-01 2026-08-09 200 0.05
```

## A. Tích luỹ, không bán — 4 cửa sổ

Cột `ROI%` tính trên **toàn bộ tiền đã cam kết** (kể cả phần nằm trong reserve).

### CHOP+RECOVERY 2022-01 → nay (4.61y, $46,230 → $65,178)
| config | dip fills | giá TB | BTC | reserve | ROI% |
|---|---|---|---|---|---|
| **100% daily (baseline)** | 0 | $41,670 | 0.26521 | $0 | **56.4** |
| 70/30 + dip −5% | 177 | $41,555 | 0.26452 | $59 | 56.5 |
| 70/30 + dip −8% | 156 | $41,728 | 0.25416 | $445 | 53.9 |
| 50/50 + dip −5% | 399 | $41,691 | 0.25830 | $283 | 54.9 |
| 50/50 + dip −8% | 189 | $43,414 | 0.24074 | $600 | 47.4 |
| 50/50 + ZONE pivot | 85 | $42,307 | 0.24703 | $600 | 51.1 |
| 100% daily, chỉ mua dưới avg | 0 | $22,682 | 0.09994 | $8,784 | 38.4 |
| 50/50 + dip −8% (không cap) | 189 | $40,349 | 0.19850 | $3,042 | 44.6 |

### BULL 2017-01 → 2021-12 (5.00y, $966 → $46,214)
| config | giá TB | BTC | ROI% |
|---|---|---|---|
| **100% daily (baseline)** | $5,398 | 2.22252 | **756.1** |
| 70/30 + dip −5% | $5,417 | 2.21248 | 752.4 |
| 50/50 + dip −8% | $5,631 | 2.09643 | 709.2 |
| 50/50 + dip −12% | $6,076 | 1.87795 | 628.3 |
| 50/50 + ZONE pivot | $6,495 | 1.75575 | 581.3 |
| 100% daily, chỉ mua dưới avg | $863 | 0.09141 | **34.6** |

### BEAR hiện tại 2025-10 → nay (0.84y, $123,519 → $65,178)
| config | giá TB | BTC | reserve | ROI% |
|---|---|---|---|---|
| 100% daily (baseline) | $77,037 | 0.02627 | $0 | −15.4 |
| 70/30 + dip −8% | $76,634 | 0.02425 | $166 | −13.7 |
| 50/50 + dip −8% | $76,265 | 0.01867 | $600 | −10.2 |
| **50/50 + dip −12%** | $74,654 | 0.01907 | $600 | **−8.9** |
| 50/50 + ZONE pivot | $74,684 | 0.01906 | $600 | −9.0 |

### BEAR 2021-11 → 2023-01 (1.23y, $66,928 → $23,127)
| config | giá TB | BTC | ROI% |
|---|---|---|---|
| 100% daily (baseline) | $26,046 | 0.11301 | −11.2 |
| 50/50 + dip −8% | $26,543 | 0.09505 | −11.0 |
| 50/50 + dip −12% | $24,626 | 0.09517 | −4.8 |
| **50/50 + ZONE pivot** | $23,761 | 0.09863 | **−2.1** |

## B. Có chốt lời (2022-01 → nay)

| config | lần bán | BTC còn | reserve | ROI% |
|---|---|---|---|---|
| 100% daily · TP 6% | 44 | 0.02638 | $9,551 | **2.0** |
| 50/50 + dip −8% · TP 6% | 51 | 0.01827 | $10,042 | 1.6 |
| 100% daily · TP 10% | 20 | 0.03117 | $9,304 | 2.6 |
| 100% daily · TP 15% | 10 | 0.03429 | $9,342 | 4.8 |
| 100% daily · TP 25% | 6 | 0.03100 | $10,598 | 14.2 |
| 50/50 + dip −8% · TP 25% | 5 | 0.02102 | $10,902 | 11.0 |
| *(không TP, tham chiếu)* | 0 | 0.26521 | $0 | **56.4** |

## Takeaway

**Chân mua-theo-ngày là động cơ; chân vùng-hỗ-trợ chỉ là bảo hiểm, và bảo hiểm đó có phí.**
Ở cả hai regime đi lên (chop-recovery và bull), mọi biến thể để dành tiền chờ hỗ trợ đều **thua**
100% daily: chop 56.4% vs 47–56.5%, bull 756% vs 581–752%. Biến thể tốt nhất (70/30, dip −5%,
reserve trần 3 tháng) chỉ ngang baseline trong sai số — reserve gần như luôn được tiêu hết vì −5%
xảy ra 70% trong 30 ngày, tức nó *là* mua-theo-ngày trá hình. Kéo trigger sâu hơn (−8/−12%) hay
dùng cụm pivot thật (`zone`, chỉ 85 fill so với 189) làm reserve nằm chết và ROI tụt thẳng.
Chân dip **chỉ** thắng trong bear thuần: 2025-10→nay −15.4% → −8.9%, 2021-11→2023-01 −11.2% → −2.1%
— nhưng nhìn cột BTC thì thấy nó thắng bằng cách **không mua** (0.02627 → 0.01907 BTC), tức giảm
rủi ro chứ không phải timing giỏi hơn. `zone` (cụm pivot) không hơn `fixed −%` ở bất kỳ đâu ngoài
bear sâu, đúng kết luận run 2026-07-26: vùng hỗ trợ ≈ bậc % cố định, không đáng để build thêm logic.
Hai luật phải tránh: **trần reserve là bắt buộc** (bỏ cap: 56.4% → 44.6%), và **"chỉ mua dưới giá
vốn" là bẫy** — nó vô hại trong bear (−15.4% → −14.7%) nhưng huỷ hoại trong bull (756% → 34.6%)
vì giá vốn không bao giờ bị vượt xuống. Cuối cùng, **đừng đặt TP nhỏ lên phần lõi**: chốt sạch tại
avg×1.06 → ROI 2.0%, ×1.15 → 4.8%, ×1.25 → 14.2%, so với 56.4% nếu chỉ giữ.
