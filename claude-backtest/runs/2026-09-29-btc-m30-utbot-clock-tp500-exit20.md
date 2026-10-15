# BTC · M30 UT Bot clock — 00:00 UTC entry, TP 500 pts, force-close 20:00 UTC, no stop

**Date:** 2026-09-29 · **Script:** scripts/run-btc-m30-utbot-clock-tp-pts-backtest.ts (args: 2024-01-01 500 20 3 0.05)

```
=== BTCUSDT · M30 UT Bot(10,3) clock · entry 00:00 UTC open · TP 500 pts · force-close 20:00 UTC · NO stop · fee 0.05%/side ===
    2024-01-01 → 2026-09-29T15:30 UTC · P&L USD per 1 BTC; (%) = account, 1x full account, compounded

  config                  | trades(L/S) |  TP%  |  win% | forced avg  | worst   | gross (acct%)            | NET (acct%)                | grossDD
  MAIN kv3 TP500 exit20   | 1003 (499/504) | TP 68% | win 71% | forced avg -1,141 | worst -8,664 | gross -28,444 (-34.5%) | NET -109,518 (-76.0%) | grossDD 56.4%
  always LONG (no filter) | 1003 (1003/0) | TP 70% | win 73% | forced avg -1,129 | worst -8,664 | gross  +6,288 (+25.0%) | NET  -74,794 (-54.2%) | grossDD 40.6%
  always SHORT (no filter)| 1003 (0/1003) | TP 67% | win 70% | forced avg -1,130 | worst -6,452 | gross -36,526 (-56.7%) | NET -117,623 (-84.1%) | grossDD 59.8%
  kv1                     | 1003 (529/474) | TP 70% | win 73% | forced avg -1,130 | worst -8,664 | gross  +5,921 (+3.2%) | NET  -75,156 (-62.2%) | grossDD 37.9%
  kv2                     | 1003 (514/489) | TP 69% | win 72% | forced avg -1,140 | worst -8,664 | gross -13,309 (-20.9%) | NET  -94,385 (-71.0%) | grossDD 42.4%
  kv4                     | 1003 (495/508) | TP 68% | win 71% | forced avg -1,099 | worst -8,664 | gross -18,312 (-22.3%) | NET  -99,392 (-71.5%) | grossDD 47.9%
  TP 300                  | 1003 (499/504) | TP 80% | win 81% | forced avg -1,272 | worst -8,664 | gross -15,127 (-22.8%) | NET  -96,197 (-71.7%) | grossDD 44.4%
  TP 700                  | 1003 (499/504) | TP 58% | win 65% | forced avg -1,035 | worst -8,664 | gross -26,610 (-38.1%) | NET -107,682 (-77.3%) | grossDD 62.8%
  TP 1000                 | 1003 (499/504) | TP 45% | win 57% | forced avg  -895 | worst -8,664 | gross -37,138 (-49.7%) | NET -118,212 (-81.6%) | grossDD 71.6%
  TP 1500                 | 1002 (498/504) | TP 31% | win 52% | forced avg  -715 | worst -8,664 | gross -20,851 (-40.7%) | NET -101,826 (-78.3%) | grossDD 68.4%
  exit 4:00 UTC           | 1003 (499/504) | TP 37% | win 49% | forced avg  -304 | worst -4,977 | gross  -4,884 (-9.4%) | NET  -85,959 (-66.8%) | grossDD 20.9%
  exit 8:00 UTC           | 1003 (499/504) | TP 46% | win 55% | forced avg  -437 | worst -5,487 | gross  -1,570 (-2.9%) | NET  -82,639 (-64.4%) | grossDD 25.5%
  exit 13:00 UTC          | 1003 (499/504) | TP 56% | win 61% | forced avg  -653 | worst -8,357 | gross -12,684 (-18.8%) | NET  -93,767 (-70.2%) | grossDD 40.2%

  MAIN MAE (worst open loss inside a trade, pts): median 455 · p75 1,156 · p90 2,294 · p95 3,058 · max 9,161
  trades that were ≥1000 pts under water at some point: 275 · ≥2000: 134 · ≥3000: 53

  MAIN by year / side
    2024 LONG  180 trades · TP 67% · gross  +3,800 · net  -8,054
    2024 SHORT 186 trades · TP 60% · gross -28,361 · net -40,614
    2025 LONG  184 trades · TP 68% · gross -30,397 · net -49,213
    2025 SHORT 181 trades · TP 74% · gross +13,781 · net  -4,484
    2026 LONG  135 trades · TP 70% · gross  +7,086 · net  -2,802
    2026 SHORT 137 trades · TP 68% · gross  +5,647 · net  -4,351

  MAIN worst 5 trades
    2025-03-03 LONG  @94,270.0 → 85,606.0 -8,664 (MAE 8,715)
    2026-01-31 LONG  @84,260.5 → 77,750.0 -6,510 (MAE 8,541)
    2024-11-06 SHORT @69,372.0 → 75,823.6 -6,452 (MAE 6,478)
    2025-01-07 LONG  @102,235.6 → 96,452.0 -5,784 (MAE 5,912)
    2024-08-05 LONG  @58,161.0 → 53,470.1 -4,691 (MAE 9,161)

```

Verdict: 71% win rate but forced exits average -1,141 pts vs +500 TP → gross -34.5% of account at kv3; only kv1 / always-long are gross-positive and all configs are net-negative (1003 trades × ~0.1% fee ≈ -80k pts). No stop = MAE up to 9,161 pts.
