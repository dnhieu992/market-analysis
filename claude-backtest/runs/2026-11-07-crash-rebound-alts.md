# Sau ngày cả thị trường sập, alt có hồi 10–15% không? (2026-11-07)

Event study trên **39 alt của watchlist /tracking-coins hiện tại** (41 coin, bỏ BTC/ETH). Nến D1 Binance 2022-01 → 2026-11.
Mua tại **giá đóng cửa ngày sập**, đo 14 ngày sau. Phí 0.05%/chiều. So với **mua ngày bất kỳ** (baseline).

## Lệnh
```bash
set -a && source .env && set +a
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-crash-rebound-study.ts claude-backtest/data/crash-rebound 2022-01-01
```

## Định nghĩa "ngày sập" (các sự kiện cách nhau < 5 ngày gộp làm một)
- `btc5`: BTC giảm ≥ 5% trong ngày
- `alt7`: alt trung vị (của watchlist) giảm ≥ 7% trong ngày
- `alt15x3`: alt trung vị giảm ≥ 15% trong 3 ngày
- bull/bear = BTC trên/dưới MA200 ngày tại ngày sập

## Kết quả (mỗi mẫu = 1 coin × 1 sự kiện)
| Nhóm | Sự kiện | Đỉnh 7d trung vị | +10% ≤7d | +10% ≤14d | +15% ≤14d | +10% trước −10% | TP10 / 14d TB |
|---|---|---|---|---|---|---|---|
| **Baseline (mọi ngày)** | — | 7.0% | 37% | 51% | 36% | 43% | −0.2% |
| btc5 | 46 | 7.3% | 41% | 53% | 37% | **34%** | 0.0% |
| alt7 | 57 | 7.7% | 40% | 53% | 34% | **36%** | +0.6% |
| **alt15x3** | **19** | **10.5%** | **53%** | **63%** | **44%** | 40% | **+4.0%** |
| alt15x3 bull | 7 | 10.1% | 51% | 61% | 39% | 34% | +4.1% |
| alt15x3 bear | 12 | 11.0% | 54% | 65% | 48% | 45% | +3.9% |

"TP10 / 14d" = mỗi coin bán ở +10%, không chạm thì bán ở giá đóng cửa ngày 14, không SL, đã trừ phí.

**alt15x3 theo từng sự kiện:** 14/19 sự kiện có lời, trung bình +3.5%/sự kiện. Các nhịp tốt: 05/2022 LUNA, 07/2024, 12/2024, 10/10/2025, 11/2025, 02/2026 (đều +8–10%). Các nhịp xấu: 11/2022 FTX −14.7% (sập tiếp), 01/2022, 04/2024, 02/2025, 31/01/2026 (−0.4 đến −3.6%).

## Kết luận
- **Sập 1 ngày (BTC −5% hoặc alt −7%) KHÔNG có lợi thế.** Tỷ lệ hồi +10% gần bằng mua ngày bất kỳ (40% so với 37%). Rủi ro còn tệ hơn: xác suất **rơi thêm −10% trước khi hồi +10%** cao hơn (chỉ 34–36% thắng so với 43% bình thường). Mua ngay ngày đỏ đầu tiên thường là bắt dao rơi.
- **Sập sâu nhiều ngày (alt trung vị −15% trong 3 ngày) thì nhận định đúng.** Đỉnh hồi trung vị trong 7 ngày là +10.5%. 63% coin chạm +10% và 44% chạm +15% trong 14 ngày. Chốt +10% thì lời trung bình +4% mỗi nhịp. Chạy được ở cả bull lẫn bear. Tuy vậy vẫn có 1/19 nhịp kiểu FTX sập tiếp −15%.
- Nhịp hồi chủ yếu đạt **+10% chứ không phải +15%**: chỉ 44% coin chạm +15% trong 14 ngày. Muốn chốt chắc thì nên đặt TP ở +10%.
- Hạn chế: chỉ có 19 sự kiện. Danh sách coin là coin còn sống và được chọn hôm nay (survivorship bias), năm 2022 chỉ có 23 coin có dữ liệu. Với nến chạm cả +TP và −10% trong cùng ngày, script tính là thua (giả định bảo thủ). Không mô phỏng lãi kép.

---

# Phần 2 — Quét ngưỡng giảm 3d / 7d / 30d (2026-11-07)

```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-crash-rebound-study.ts claude-backtest/data/crash-rebound 2022-01-01 sweep
```
Mức giảm đo close-to-close, theo 2 cách: **thị trường** = alt trung vị cả watchlist giảm tới ngưỡng (1 sự kiện = mua cả 39 alt), **coin** = chính coin đó giảm tới ngưỡng (1 sự kiện = 1 coin). Mua ở close ngày chạm ngưỡng, giữ tối đa 14 ngày. Tín hiệu chỉ bật lại sau 5 ngày liền không chạm ngưỡng.
Baseline (mọi ngày): +10% ≤14d **51%**, +15% ≤14d **36%**, TP10 TB −0.2%.

| Ngưỡng | Thị trường: sự kiện / +10% ≤14d / +15% ≤14d / TP10 TB | Coin: mẫu / +10% ≤14d / +15% ≤14d / TP10 TB |
|---|---|---|
| 3d ≤ −10% | 57 / 51% / 34% / +0.4% | 2168 / 53% / 37% / +0.1% |
| 3d ≤ −15% | 19 / 63% / 44% / +4.0% | 950 / 63% / 45% / +2.4% |
| **3d ≤ −20%** | 7 / 77% / 55% / +7.0% | **343 / 69% / 52% / +4.1%** |
| **3d ≤ −25%** | 3 / 95% / 77% / +9.4% | **128 / 87% / 71% / +7.1%** |
| 7d ≤ −10% | 63 / 53% / 36% / +0.9% | 2083 / 52% / 36% / +0.2% |
| 7d ≤ −15% | 35 / 63% / 45% / +3.1% | 1368 / 61% / 43% / +2.0% |
| 7d ≤ −20% | 15 / 66% / 43% / +4.8% | 758 / 65% / 47% / +3.0% |
| **7d ≤ −25%** | **10 / 91% / 72% / +8.7%** | **374 / 75% / 57% / +5.2%** |
| **7d ≤ −30%** | 3 / 91% / 77% / +8.6% | **174 / 83% / 68% / +7.0%** |
| 30d ≤ −20% | 30 / 56% / 38% / +2.3% | 941 / 52% / 37% / +0.2% |
| 30d ≤ −25% | 28 / 60% / 40% / +2.2% | 800 / 58% / 38% / +1.2% |
| **30d ≤ −30%** | **16 / 75% / 52% / +4.2%** | 621 / 64% / 45% / +2.1% |
| **30d ≤ −35%** | **10 / 77% / 61% / +5.9%** | 443 / 69% / 52% / +3.3% |
| 30d ≤ −40% | 5 / 76% / 51% / +3.5% | **302 / 75% / 56% / +4.6%** |
| 30d ≤ −50% | 1 / — | 84 / 75% / 60% / +3.9% |

## Kết luận phần 2
Ngưỡng bắt đầu có cú hồi 10–15% đáng tin (≥ ~70% chạm +10%, ≥ ~50% chạm +15% trong 14 ngày):
- **3 ngày: −20%** (coin) — −25% thì 87% chạm +10%, 71% chạm +15%. Thị trường −15% là mức bắt đầu có lợi thế.
- **7 ngày: −25%** (cả thị trường lẫn coin) — thị trường −25%/7d: 91% chạm +10%, 72% chạm +15%, TP10 TB +8.7% (10 sự kiện).
- **30 ngày: −30% (thị trường) / −40% (coin)** — khung 30 ngày yếu nhất: hồi +10% được nhưng +15% chỉ ~50–60%, vì giảm dài hạn hay là xu hướng giảm chứ không phải hoảng loạn.
- Dưới các ngưỡng này (3d −10%, 7d −10/−15%, 30d −15/−25%) gần như = mua ngày bất kỳ.
- Giảm càng nhanh càng hồi mạnh: cùng mức −30%, trong 3 ngày (95% chạm +10%) tốt hơn trong 30 ngày (64%).
- Các ngưỡng cực sâu ở mức thị trường (3d −30%, 7d −35/−40%, 30d −50%) chỉ có 1–3 sự kiện (chủ yếu LUNA 05/2022, 10/10/2025) — không đủ để tin.
