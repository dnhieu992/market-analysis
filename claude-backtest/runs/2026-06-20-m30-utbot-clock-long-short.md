# M30 UTBot directional clock — 00:00 UTC entry, TP 0.5%, force-close 08:00

**Date:** 2026-06-20
**Script:** `scripts/run-m30-utbot-clock-backtest.ts`
**Window:** 365 days · `30m` · $1000 fixed/trade · fee 0.05%/side · UTBot ATR(10)
**Context:** user idea — at 00:00 UTC read the **M30 UTBot** trend (last closed 30m candle = 23:30):
bull → LONG, bear → SHORT. TP 0.5%, no stop, force-close 08:00 UTC. Tested on BTC/ETH/BNB/SOL.

## Command
```bash
# [days fee notional tpPct exitHour kv atrPeriod]
scripts/run-m30-utbot-clock-backtest.ts 365 0.05 1000 0.5 8 2 10
```

## Results — kv=2, exit 08:00 (the requested config)

| symbol | L/S | TP hit | WR | GROSS | NET | net/trade |
|--------|-----|------:|----:|------:|----:|----------:|
| BTCUSDT | 180/185 | 193 | 60.5% | +$58.23 | −$306.73 | −$0.84 |
| ETHUSDT | 189/176 | 259 | 73.2% | +$53.52 | −$311.44 | −$0.85 |
| BNBUSDT | 199/166 | 235 | 68.5% | +$211.58 | −$153.54 | −$0.42 |
| SOLUSDT | 180/185 | 268 | 75.6% | +$158.54 | −$206.53 | −$0.57 |
| **TOTAL** | 748/712 | 955 | 69.5% | **+$481.87** | **−$978.25** | −$0.67 |

## kv / exit-hour sweep (totals)

| config | GROSS | NET |
|--------|------:|----:|
| **kv=1 · exit 08:00** | **+$630.50** | −$829.77 |
| kv=2 · exit 08:00 | +$481.87 | −$978.25 |
| kv=3 · exit 08:00 | +$456.03 | −$1,004.06 |
| kv=4 · exit 08:00 | +$180.45 | −$1,279.36 |
| kv=2 · exit 04:00 | +$260.01 | −$1,199.88 |

## Takeaway

**The M30 UTBot direction filter genuinely adds edge** — unlike the earlier bare clock tests (gross ≈0
or negative), gross is now **positive on all 4 symbols** with ~70% win rate. More responsive UTBot is
better (**kv=1 → highest gross +$630**); high kv picks direction worse. BNB stands out (+$212 gross at
kv2). So selecting long/short by the prevailing M30 trend works directionally.

**But net is still negative — the same fee wall.** Best gross +$630 / 1460 / $1000 = **0.043%/trade**,
still under the **0.1% round-trip fee**. Trading every day × 4 symbols = 1460 trades × $1 = **$1,460/yr
in fees**, which swamps the +$630 edge → net −$830 at best.

**Core problem unchanged: intraday edge (~0.04%/trade) < fee (0.1%/trade).** M30 UTBot roughly doubles
the gross edge vs the bare clock but still falls short. To turn it profitable: (a) **cut fees** — at
maker ~0.02%/side the +$630 gross flips net-positive immediately; or (b) **trade only BNB/SOL** (largest
% edge) and **skip low-conviction days** to cut trade count. As specified at 0.05%/side taker fees on
all 4 symbols every day, it loses.

## UPDATE — per-symbol TP (BTC 0.5%, alts 2%)

User's correction: a 0.5% TP is too small for the higher-% alts — alts should target 2%. Re-ran with
BTC=0.5%, ETH/BNB/SOL=2% (`scripts/run-m30-utbot-clock-backtest.ts 365 0.05 1000 0.5 8 <kv> 10 2`).

**kv=2:** BTC +$58g/−$307n · ETH −$403g/−$768n · **BNB +$435g/+$69.54n ✅** · SOL −$178g/−$542n
**kv=1:** BTC +$23g/−$342n · ETH +$237g/−$128n · BNB +$216g/−$149n · **SOL +$393g/+$27.77n ✅**

**This flips the conclusion for some alts.** With a 2% TP each winner pays 2% vs the 0.1% fee (20:1), so
a slightly-better-than-50% directional hit rate nets positive — unlike the 0.5% TP where fees dominate.
**BNB (kv2) net +$69.54** and **SOL (kv1) net +$27.77** are genuinely net-positive after fees. ETH/BNB
get close to breakeven at kv1. BTC stays negative (its % edge is too small — 0.5% is the right TP for it
but still not enough).

**Caveats: (1) inconsistent across kv** (BNB best at kv2, SOL best at kv1, ETH negative at kv2) → real
curve-fit risk, needs out-of-sample validation. **(2) No stop = real tail risk** — ETH kv2 gross −$403
means some days ran hard against the position into the 08:00 exit; a ~50% win rate with unbounded
losers is fragile. A protective stop or a 1D-trend filter (as in the long-alt study) is the obvious
next step before trusting BNB/SOL standalone.

## UPDATE — BTC only, TP 0.75% (kv sweep)

`SYMBOLS=BTCUSDT … 365 0.05 1000 0.75 8 <kv> 10 0.75`

| kv | TP hit | WR | GROSS | NET |
|---:|------:|----:|------:|----:|
| 1 | 145 | 57.8% | +$110.43 | −$254.59 |
| 2 | 138 | 51.2% | −$36.29 | −$401.16 |
| 3 | 143 | 52.9% | +$29.19 | −$335.75 |

Raising BTC's TP to 0.75% lifts gross at kv1 (+$110 vs +$23 at 0.5%) but it still **loses at every kv**:
best gross +$110/365/$1000 = **0.030%/trade**, below the 0.1% fee → net −$255. Confirms BTC's intraday
% edge is structurally too small to clear taker fees; no TP/kv setting fixes it. Only a low-fee venue
or fewer (higher-conviction) trades could.
