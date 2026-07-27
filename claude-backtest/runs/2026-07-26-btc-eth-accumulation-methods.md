# BTC & ETH — cách mua nào tích lũy được nhiều coin nhất

Mục tiêu: **tối đa số coin sở hữu trên mỗi đô bỏ vào** (không phải return, không phải drawdown).
Không bao giờ bán.

## Command

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-accumulation-methods-backtest.ts "BTCUSDT,ETHUSDT" 2900 100 0.05
```

## Config & phương pháp so sánh công bằng

| | |
|---|---|
| Data | BTCUSDT / ETHUSDT D1, 2019-03 → 2026-07 (warm-up MA200) |
| Ngân sách | $100/tháng, **mọi phương pháp nhận cùng số tiền, cùng lịch** — chỉ khác ở *khi nào* tiêu |
| Fee | 0.05%/side |
| Chỉ số chính | `coins/$1k` = (số coin + tiền mặt dư / giá cuối) / tổng đóng góp × 1000 |
| Khử may rủi | Mỗi con số là **trung bình của 30 offset ngày bắt đầu** — nếu không, một phương pháp có thể ăn may vì trúng ngày mua đẹp. Cột `spread%` = biên độ max-min giữa các offset = mức nhiễu. |

Tiền mặt dư được quy đổi ra coin theo giá cuối kỳ, nếu không phương pháp ôm tiền sẽ được
lợi/thiệt giả tạo tùy ngày kết thúc.

## Kết quả toàn kỳ (2019-2026)

| Phương pháp | BTC coins/$1k | vs base | ETH coins/$1k | vs base | idle% |
|---|---|---|---|---|---|
| **mua ngay khi có tiền (tháng)** | **0.04650** | **0.00%** | **1.49600** | **0.00%** | 0.0 |
| depth-scaled MA200 (rẻ mua nhiều) | 0.04646 | −0.08% | 1.49546 | −0.04% | 0.0 |
| mua ngay (tuần) | 0.04560 | −1.92% | 1.47098 | −1.67% | 0.0 |
| mua ngay (ngày) | 0.04538 | −2.41% | 1.46442 | −2.11% | 0.0 |
| 80% ngay + 20% chờ dip sâu | — | — | 1.47140 | −1.64% | 0.2 |
| 70% ngay + 30% chờ dip | — | — | 1.46092 | −2.34% | 0.3 |
| chờ close < EMA34 rồi all-in | 0.04269 | −8.19% | 1.45045 | −3.04% | 0.1 |
| RSI14 < 35 | 0.04236 | −8.90% | 1.28407 | −14.17% | 1.0 |
| ladder EMA34 4 tầng | 0.04211 | −9.43% | 1.36049 | −9.06% | 1.0 |
| chỉ mua khi < MA200 | 0.04167 | −10.38% | 1.37017 | −8.41% | 0.0 |
| value averaging | 0.04166 | −10.40% | 1.36479 | −8.77% | 68–85 |

Nhiễu (`spread`) toàn kỳ ~5%, nên các mức −8…−14% là thật, còn −1.6…−2.4% thì sát mép nhiễu.

## Phân rã theo chế độ thị trường (ETH)

| Phương pháp | 2020-21 bull | 2022 bear | 2023-26 |
|---|---|---|---|
| mua ngay (tháng) | 0.00% | 0.00% | 0.00% |
| mua ngay (ngày) | −8.59% | **+2.13%** | −0.80% |
| chờ EMA34 all-in | **−37.40%** | +1.73% | −0.16% |
| ladder EMA34 | **−39.81%** | **+11.50%** | −0.31% |
| chỉ mua < MA200 | **−44.94%** | +1.79% | +1.45% |
| RSI14 < 35 | **−48.92%** | **+12.28%** | +0.15% |
| depth-scaled MA200 | −0.58% | +0.03% | −0.02% |

BTC cùng dạng: bull 2020-21 mọi luật chờ đáy mất 16–38%, bear 2022 kiếm lại 1–13%.

## Takeaway

**Mua ngay khi có tiền là cách tích lũy nhiều coin nhất trên cả BTC lẫn ETH** — mọi luật
"chờ giá rẻ" đều thua 3–14% số coin qua 7 năm. Cơ chế rất rõ khi tách theo chế độ thị trường:
luật chờ đáy kiếm được 2–13% trong bear 2022, nhưng mất 16–49% trong bull 2020-21, và vì
BTC/ETH đi lên trong dài hạn nên phần thua áp đảo phần thắng. Ngay cả tần suất cũng theo
đúng logic đó: mua theo tháng hơn theo ngày ~2% — không phải vì "tháng tốt hơn ngày" mà vì
chia nhỏ tiền ra cả tháng khiến mỗi đô được giải ngân trễ hơn trung bình 15 ngày, và trong
xu hướng tăng trễ = đắt (đúng như dự đoán, hiệu ứng này **đảo chiều** trong bear 2022).
Ngoại lệ duy nhất hòa được với baseline là **depth-scaled MA200** (−0.05%): tiêu 1.5–3× ngân
sách khi giá dưới MA200 và 0.4–0.7× khi trên, nhưng **không bao giờ ôm tiền mặt** — nó cho
cảm giác "mua nhiều lúc rẻ" mà không trả giá bằng thời gian đứng ngoài. Ladder EMA34 ở
run trước (`2026-07-26-eth-ema34-dca-ladder-allocation.md`) mất 9% số coin trên cả hai đồng,
nên chỉ dùng khi đã có sẵn một cục vốn, không dùng cho tích lũy định kỳ. Cảnh báo: toàn bộ
kết luận này phụ thuộc vào việc BTC/ETH đã tăng trong 7 năm test; nếu vào một bear dài nhiều
năm thì các luật chờ sẽ thắng — và không có phương pháp nào biết trước điều đó.
