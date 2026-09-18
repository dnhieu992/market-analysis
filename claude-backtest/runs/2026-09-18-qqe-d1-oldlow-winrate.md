# QQE bull-flip (D1) — win rate vs "break the old low"

**Date:** 2026-09-18
**Strategy:** the QQE D1 alert signal (`/bitget` Setup tab). Enter LONG on each D1 candle
that closes with a QQE green ▲ (`cross === 'long'`), QQE params `10/4/3.2`. Measure whether
price rises **+5% / +10% / +15%** (intra-candle high) **before** breaking the most recent
strong swing low ("đáy cũ"). A break of that low = **FAILED**. No leverage, no fees (this is
a hit-rate study — whether a level is touched first — not a P&L curve).

- **"Old low"** = the low of the most recent *confirmed* swing-low pivot below the entry price.
  Pivot = a local min with `pivot` bars on each side (no lookahead).
- **WIN@X** = high hits entry×(1+X%) before any low breaks the old low. Same-bar tie = FAIL (pessimistic).

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-qqe-d1-oldlow-winrate.ts 1d 2023-01-01 5
# sensitivity: pivot 3 and 10 as the 3rd arg
```

## Config
- Interval **D1**, from **2023-01-01 → 2026-09-18**.
- Basket = **33 Setup-tab coins** (BTC, ETH, BNB, SOL, XRP, ADA, AVAX, LINK, DOGE, LTC, BCH,
  ETC, UNI, NEAR, APT, ARB, OP, SUI, INJ, TIA, FIL, HBAR, AAVE, POL, PEPE, SHIB, WLD, FET, TAO,
  ONDO, IOTX, DOT, ATOM). Newer coins contribute fewer signals.
- Pivot windows tested: 3, **5** (headline), 10.

## Results — win rate = win / (win + fail)

Headline (pivot 5, **1637 signals**):

| Target | win | fail | undecided | **win rate** |
|-------:|----:|-----:|----------:|-------------:|
| +5%    |1064 | 557  | 16        | **65.6%** |
| +10%   | 838 | 777  | 22        | **51.9%** |
| +15%   | 690 | 921  | 26        | **42.8%** |

- **Hard fail** (broke the old low before even +5%): **34.0%** of all signals.
- Of signals that ever broke the old low, **median time to break = 8 bars (~8 days)**.

Pivot sensitivity (aggregate win rate):

| pivot | n | +5% | +10% | +15% | hard-fail |
|------:|--:|----:|-----:|-----:|----------:|
| 3     |1684|67.5%|52.9%|43.2%|32.2%|
| **5** |1637|**65.6%**|**51.9%**|**42.8%**|**34.0%**|
| 10    |1565|69.5%|57.7%|49.4%|30.1%|

Per year (pivot 5):

| year | n | +5% | +10% | +15% |
|-----:|--:|----:|-----:|-----:|
| 2023 |338|65.1%|53.6%|45.6%|
| 2024 |454|73.1%|62.1%|54.2%|
| 2025 |506|58.9%|41.1%|30.3%|
| 2026 |339|66.3%|52.7%|43.5%|

Best coins @+10% (pivot 5): FET 68%, TAO/PEPE 64%, INJ 63%. Worst: POL 35%, DOT/ETH 38%, XRP/ETC 42%.

## SHORT mirror (bear-flip ▼)

Same idea, mirrored: enter SHORT on a QQE red ▼ close; **win = price drops −X% before breaking the
most recent strong swing HIGH ("đỉnh cũ")**; a break of that high = FAILED. Command adds `--short`:
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-qqe-d1-oldlow-winrate.ts 1d 2023-01-01 5 --short
```

Headline (pivot 5, **1611 signals**):

| Target | win | fail | undecided | **win rate** |
|-------:|----:|-----:|----------:|-------------:|
| −5%    |1150 | 453  | 8         | **71.7%** |
| −10%   | 914 | 672  | 25        | **57.6%** |
| −15%   | 757 | 821  | 33        | **48.0%** |

- **Hard fail** (broke the old high before −5%): **28.1%**. Median time to break = **7 bars**.

Pivot sensitivity (short):

| pivot | n | −5% | −10% | −15% | hard-fail |
|------:|--:|----:|-----:|-----:|----------:|
| 3     |1649|73.8%|58.9%|48.2%|26.1%|
| **5** |1611|**71.7%**|**57.6%**|**48.0%**|**28.1%**|
| 10    |1569|78.0%|64.8%|56.2%|21.9%|

Per year (short, pivot 5):

| year | n | −5% | −10% | −15% |
|-----:|--:|----:|-----:|-----:|
| 2023 |335|63.3%|50.7%|43.3%|
| 2024 |425|67.3%|53.6%|40.7%|
| 2025 |488|**84.8%**|**71.5%**|**65.4%**|
| 2026 |363|67.0%|49.4%|36.4%|

Best short coins @−10% (pivot 5): TIA 80%, PEPE 79%, POL 78%, WLD 75%. Worst: BNB 33%, BTC 37%, LTC 39%.

### Long vs short (pivot 5, D1)
| Target | LONG win | SHORT win |
|-------:|---------:|----------:|
| ±5%    | 65.6%    | **71.7%** |
| ±10%   | 51.9%    | **57.6%** |
| ±15%   | 42.8%    | **48.0%** |

Short edges out long by ~5–6pp overall — but that's almost entirely **2025** (a down/chop year:
short +10% = 71.5% vs long 41.1%). In 2024 (up year) long was better. So the "better side" is really
a **regime read**, not a fixed property of the signal — both sides sit ~50% at +10% once you average
across regimes. `undecided` counts are tiny (<3%), so the sample is well-resolved.

## Takeaway
On D1, a QQE bull flip reaches **+5% before breaking the recent strong low ~66% of the time**,
**+10% ~52%**, and **+15% ~43%** — robust across pivot definitions (±2–6pp). The "break the old
low" hard-fail rate is ~30–34%, and when a signal fails it typically breaks within ~8 days.
2024 was clearly the strongest regime (+10% at 62%) and 2025 the weakest (+10% at 41%), so the
edge is regime-dependent. Practical read: +5–10% targets are the sweet spot; +15% is roughly a
coin-flip and leans on a strong-trend year. Next: same study for **H4**, and optionally a
"reward vs risk" cut (target % vs the actual distance down to the old low) to size stops.
