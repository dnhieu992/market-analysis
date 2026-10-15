# BTC M30 · SR Channel (10,H/L,5,1,6,290) bounce/rejection · 2024-01-01 → 2026-09-29

Script: scripts/run-btc-srchannel-reversal-m30-backtest.ts (args: 2024-01-01 400 3 0.05)

Long: touch support + bullish reversal candle (engulfing/pin, ≤3 bars) → enter at close. Short mirrored. TP = next S/R zone edge if ≥400 pts away (else skip). SL = candle close beyond the zone. Fee 0.05%/side. No look-ahead (pivots confirmed after 10 bars, channels recomputed on pivot bars like Pine).

```

=== BTCUSDT M30 · SR Channel (10,H/L,5,1,6,290) bounce/rejection · 2024-01-01 → 2026-09-29T15:00 UTC · 48127 bars ===
    min TP 400 pts · reversal window K=3 bars · fee 0.05%/side · P&L in USD per 1 BTC (= price points), net of fees

  variant                              | trades (L/S) | TP% | avg win | avg loss |  PF  | gross pts | NET pts  | maxDD pts | max L-streak | avg hold
  MAIN engulf+pin · filter             | 951 (481/470) |  39% |    +756 |     -646 | 0.74 |   -19,572 |  -98,735 |   100,620 |           19 | 6.5h
  engulf only · filter                 | 532 (269/263) |  42% |    +799 |     -788 | 0.72 |   -23,815 |  -68,241 |    71,686 |           10 | 7.9h
  closeback · filter                   | 1226 (632/594) |  40% |    +749 |     -711 | 0.70 |   -52,474 | -154,523 |   160,691 |           12 | 6.7h
  engulf+pin · skip-to-400             | 1256 (614/642) |  38% |    +798 |     -639 | 0.75 |   -20,305 | -123,964 |   125,002 |           11 | 6.8h
  engulf+pin · filter · SMA200 trend   | 474 (237/237) |  40% |    +741 |     -675 | 0.72 |   -13,854 |  -53,814 |    53,814 |           16 | 6.3h
  closeback · filter · SMA200 trend    | 690 (356/334) |  42% |    +746 |     -773 | 0.69 |   -39,329 |  -97,329 |   107,537 |           11 | 7.0h

  MAIN by year / side
    2024 LONG  trades 167 · TP  44% · net   -1,408 pts · PF 0.98
    2024 SHORT trades 165 · TP  36% · net  -21,943 pts · PF 0.66
    2025 LONG  trades 191 · TP  38% · net  -32,539 pts · PF 0.66
    2025 SHORT trades 181 · TP  43% · net   -5,541 pts · PF 0.92
    2026 LONG  trades 123 · TP  38% · net  -10,997 pts · PF 0.74
    2026 SHORT trades 124 · TP  29% · net  -26,307 pts · PF 0.45

  MAIN last 12 trades
    2026-09-19T03:30 SHORT @81,136.0 zone 81,400–81,400 TP 79,600 → SL  81,410.0 (09-19T09:00) net -355
    2026-09-20T15:00 SHORT @80,667.2 zone 80,845–80,904 TP 77,482 → SL  80,912.0 (09-20T15:30) net -326
    2026-09-21T01:00 SHORT @81,584.0 zone 81,400–81,741 TP 80,904 → TP  80,904.5 (09-21T01:30) net +598
    2026-09-21T05:30 SHORT @81,550.0 zone 81,400–81,741 TP 80,904 → SL  81,814.0 (09-21T06:00) net -346
    2026-09-22T23:00 SHORT @86,226.0 zone 86,378–86,718 TP 85,462 → SL  87,020.0 (09-23T04:00) net -881
    2026-09-23T09:00 SHORT @85,888.4 zone 86,000–86,378 TP 85,462 → TP  85,461.5 (09-23T11:30) net +341
    2026-09-23T13:00 LONG  @85,548.0 zone 85,114–85,462 TP 86,000 → SL  84,041.7 (09-23T14:00) net -1,591
    2026-09-24T11:00 SHORT @83,522.0 zone 83,500–83,745 TP 81,951 → SL  83,780.0 (09-24T13:00) net -342
    2026-09-25T01:00 SHORT @84,540.2 zone 84,670–85,114 TP 83,745 → TP  83,744.7 (09-25T13:30) net +711
    2026-09-25T15:30 LONG  @83,796.0 zone 83,500–83,751 TP 84,622 → TP  84,622.0 (09-27T05:30) net +742
    2026-09-27T09:30 LONG  @84,944.0 zone 84,337–84,670 TP 86,378 → SL  84,195.3 (09-27T22:30) net -833
    2026-09-29T09:30 LONG  @84,258.0 zone 83,745–83,856 TP 84,670 → SL  82,994.5 (09-29T15:00) net -1,347

```

Verdict: loses in every variant, even before fees (gross PF < 1). Not tradable as specified.

## Session filter (entry candle UTC hour): Asia 00-08, EU 08-13, US 13-21

```

  variant                              | trades (L/S) | TP% | avg win | avg loss |  PF  | gross pts | NET pts  | maxDD pts | max L-streak | avg hold
  all sessions (baseline)              | 951 (481/470) |  39% |    +756 |     -646 | 0.74 |   -19,572 |  -98,735 |   100,620 |           19 | 6.5h
  MAIN Asia+EU 00-13 UTC               | 555 (269/286) |  40% |    +721 |     -601 | 0.81 |    +7,909 |  -38,573 |    45,737 |           12 | 6.5h
  Asia only 00-08                      | 376 (179/197) |  40% |    +683 |     -590 | 0.78 |    +1,707 |  -29,732 |    44,595 |           11 | 6.9h
  EU only 08-13                        | 239 (121/118) |  40% |    +771 |     -641 | 0.79 |    +1,234 |  -19,018 |    21,633 |            8 | 6.1h
  US only 13-21 (contrast)             | 431 (234/197) |  40% |    +829 |     -711 | 0.79 |    -2,719 |  -38,601 |    39,791 |           13 | 6.8h
  Asia+EU + force-close 13:00          | 580 (280/300) |  23% |    +552 |     -252 | 0.73 |   +10,203 |  -38,520 |    39,493 |            9 | 3.7h
  Asia+EU · engulf only                | 310 (146/164) |  42% |    +772 |     -710 | 0.79 |    -1,386 |  -27,314 |    32,578 |            7 | 7.6h
  Asia+EU · SMA200 trend               | 261 (117/144) |  40% |    +701 |     -594 | 0.78 |    +1,803 |  -20,430 |    22,633 |            9 | 6.0h

  MAIN by year / side
    2024 LONG  trades  85 · TP  47% · net   +7,578 pts · PF 1.31
    2024 SHORT trades  92 · TP  39% · net   -8,729 pts · PF 0.71
    2025 LONG  trades 114 · TP  41% · net  -11,317 pts · PF 0.77
    2025 SHORT trades 115 · TP  43% · net   -3,688 pts · PF 0.91
    2026 LONG  trades  70 · TP  34% · net   -8,893 pts · PF 0.65
    2026 SHORT trades  79 · TP  33% · net  -13,524 pts · PF 0.53

  MAIN last 12 trades
    2026-09-15T11:00 SHORT @77,001.1 zone 77,164–77,341 TP 76,500 → TP  76,500.0 (09-15T13:30) net +424
    2026-09-18T01:30 LONG  @76,744.0 zone 76,389–76,561 TP 77,164 → TP  77,164.1 (09-18T03:00) net +343
    2026-09-18T04:30 LONG  @77,576.0 zone 77,164–77,343 TP 79,600 → TP  79,600.0 (09-18T13:30) net +1,945
    2026-09-19T03:30 SHORT @81,136.0 zone 81,400–81,400 TP 79,600 → SL  81,410.0 (09-19T09:00) net -355
    2026-09-21T01:00 SHORT @81,584.0 zone 81,400–81,741 TP 80,904 → TP  80,904.5 (09-21T01:30) net +598
    2026-09-21T05:30 SHORT @81,550.0 zone 81,400–81,741 TP 80,904 → SL  81,814.0 (09-21T06:00) net -346
    2026-09-23T09:00 SHORT @85,888.4 zone 86,000–86,378 TP 85,462 → TP  85,461.5 (09-23T11:30) net +341
    2026-09-24T11:00 SHORT @83,522.0 zone 83,500–83,745 TP 81,951 → SL  83,780.0 (09-24T13:00) net -342
    2026-09-25T01:00 SHORT @84,540.2 zone 84,670–85,114 TP 83,745 → TP  83,744.7 (09-25T13:30) net +711
    2026-09-27T01:00 SHORT @84,333.0 zone 84,337–84,670 TP 83,751 → SL  84,791.0 (09-27T07:30) net -543
    2026-09-27T09:30 LONG  @84,944.0 zone 84,337–84,670 TP 86,378 → SL  84,195.3 (09-27T22:30) net -833
    2026-09-29T09:30 LONG  @84,258.0 zone 83,745–83,856 TP 84,670 → SL  82,994.5 (09-29T15:00) net -1,347

```

Verdict: skipping US entries turns GROSS slightly positive (+7.9k pts, PF 0.81 net) but fees (~85 pts/trade) still make it a net loser. Only 2024 longs were profitable.

## Same strategy on M5 (args: 2024-01-01 400 3 0.05 5m)

```

  variant                              | trades (L/S) | TP% | avg win | avg loss |  PF  | gross pts | NET pts  | maxDD pts | max L-streak | avg hold
  all sessions (baseline)              | 1903 (927/976) |  26% |    +610 |     -359 | 0.61 |   -35,656 | -198,734 |   199,157 |           21 | 1.8h
  MAIN Asia+EU 00-13 UTC               | 989 (479/510) |  23% |    +594 |     -337 | 0.54 |   -32,271 | -117,334 |   118,529 |           21 | 1.8h
  Asia only 00-08                      | 622 (301/321) |  24% |    +615 |     -329 | 0.58 |   -11,116 |  -64,766 |    66,856 |           17 | 2.1h
  EU only 08-13                        | 403 (198/205) |  23% |    +546 |     -357 | 0.45 |   -26,955 |  -61,541 |    62,172 |           16 | 1.4h
  US only 13-21 (contrast)             | 817 (392/425) |  30% |    +619 |     -398 | 0.67 |    -6,218 |  -75,872 |    82,837 |           22 | 1.5h
  Asia+EU + force-close 13:00          | 990 (479/511) |  18% |    +573 |     -261 | 0.53 |   -23,344 | -108,479 |   109,838 |           20 | 1.5h
  Asia+EU · engulf only                | 533 (273/260) |  28% |    +595 |     -399 | 0.58 |   -18,151 |  -63,680 |    65,234 |           12 | 2.3h
  Asia+EU · SMA200 trend               | 507 (240/267) |  26% |    +562 |     -337 | 0.59 |    -7,857 |  -51,104 |    51,537 |           18 | 1.9h

  % of account (1x, full account per trade)
  all sessions (baseline)              | gross sum   -43.5% · gross compounded   -37.6% (maxDD 43.9%) | net sum  -233.8% · net compounded   -90.7%
  MAIN Asia+EU 00-13 UTC               | gross sum   -44.9% · gross compounded   -37.2% (maxDD 40.1%) | net sum  -143.8% · net compounded   -76.7%
  Asia only 00-08                      | gross sum   -16.1% · gross compounded   -15.6% (maxDD 20.6%) | net sum   -78.3% · net compounded   -54.7%
  EU only 08-13                        | gross sum   -36.1% · gross compounded   -30.8% (maxDD 32.1%) | net sum   -76.4% · net compounded   -53.8%
  US only 13-21 (contrast)             | gross sum    +1.7% · gross compounded    -0.2% (maxDD 29.8%) | net sum   -80.0% · net compounded   -55.9%
  Asia+EU + force-close 13:00          | gross sum   -32.6% · gross compounded   -28.8% (maxDD 32.3%) | net sum  -131.7% · net compounded   -73.6%
  Asia+EU · engulf only                | gross sum   -26.2% · gross compounded   -23.9% (maxDD 27.7%) | net sum   -79.5% · net compounded   -55.3%
  Asia+EU · SMA200 trend               | gross sum   -13.2% · gross compounded   -13.1% (maxDD 15.3%) | net sum   -63.9% · net compounded   -47.7%

  Stop-loss trades (loss per 1 BTC, fees excluded / included; % = of entry price)
  all sessions (baseline)              | SL 1403 · avg $274 (net $359) · 0.33% · median $220 · p75 $349 · p90 $511 · max $3,518
  MAIN Asia+EU 00-13 UTC               | SL 757 · avg $251 (net $337) · 0.31% · median $200 · p75 $317 · p90 $472 · max $1,436
  Asia only 00-08                      | SL 474 · avg $243 (net $329) · 0.30% · median $200 · p75 $309 · p90 $452 · max $1,436
  EU only 08-13                        | SL 312 · avg $271 (net $357) · 0.34% · median $214 · p75 $337 · p90 $550 · max $1,303
  US only 13-21 (contrast)             | SL 572 · avg $312 (net $398) · 0.37% · median $264 · p75 $406 · p90 $583 · max $3,518
  Asia+EU + force-close 13:00          | SL 671 · avg $243 (net $329) · 0.30% · median $193 · p75 $298 · p90 $455 · max $1,356 | time-exit 139 · avg +150
  Asia+EU · engulf only                | SL 383 · avg $315 (net $399) · 0.39% · median $257 · p75 $406 · p90 $577 · max $1,356
  Asia+EU · SMA200 trend               | SL 374 · avg $252 (net $337) · 0.32% · median $211 · p75 $318 · p90 $464 · max $1,436

  MAIN by year / side
    2024 LONG  trades 149 · TP  23% · net  -16,581 pts · PF 0.57
    2024 SHORT trades 155 · TP  24% · net  -17,286 pts · PF 0.54
    2025 LONG  trades 234 · TP  25% · net  -29,650 pts · PF 0.54
    2025 SHORT trades 247 · TP  25% · net  -27,076 pts · PF 0.60
    2026 LONG  trades  96 · TP  22% · net  -10,874 pts · PF 0.49
    2026 SHORT trades 108 · TP  18% · net  -15,867 pts · PF 0.40

  MAIN last 12 trades
    2026-09-16T11:45 LONG  @76,228.0 zone 76,098–76,194 TP 76,844 → SL  76,001.6 (09-16T12:20) net -303
    2026-09-19T05:25 SHORT @81,073.3 zone 81,050–81,258 TP 80,556 → SL  81,286.0 (09-19T08:20) net -294
    2026-09-19T08:25 LONG  @81,298.0 zone 81,050–81,250 TP 81,741 → TP  81,741.0 (09-19T15:05) net +361
    2026-09-20T08:00 LONG  @80,450.0 zone 80,227–80,311 TP 80,904 → TP  80,904.5 (09-20T15:00) net +374
    2026-09-21T04:15 SHORT @81,272.0 zone 81,294–81,296 TP 80,850 → SL  81,304.9 (09-21T04:25) net -114
    2026-09-21T12:35 SHORT @85,282.1 zone 85,300–85,300 TP 84,130 → SL  85,323.0 (09-21T12:55) net -126
    2026-09-22T02:10 LONG  @85,605.1 zone 85,300–85,607 TP 86,071 → SL  85,226.9 (09-22T05:15) net -464
    2026-09-22T05:20 SHORT @85,243.5 zone 85,300–85,607 TP 84,130 → SL  85,900.0 (09-22T08:35) net -742
    2026-09-22T10:35 LONG  @85,919.1 zone 85,600–85,743 TP 86,345 → TP  86,344.7 (09-22T13:55) net +339
    2026-09-23T07:55 SHORT @86,124.8 zone 86,170–86,271 TP 85,569 → TP  85,569.5 (09-23T11:20) net +469
    2026-09-26T12:10 LONG  @84,150.0 zone 84,020–84,123 TP 84,600 → SL  84,008.0 (09-26T13:10) net -226
    2026-09-28T12:15 LONG  @83,416.7 zone 83,210–83,296 TP 84,132 → SL  82,948.3 (09-28T14:40) net -552

```

Verdict M5: worse than M30 in every variant, gross negative everywhere except US-only (~flat). TP hit only 18-30%.

## M5 with FIXED TP 500 (args: 2024-01-01 500 3 0.05 5m fixed)

```

  variant                              | trades (L/S) | TP% | avg win | avg loss |  PF  | gross pts | NET pts  | maxDD pts | max L-streak | avg hold
  all sessions (baseline)              | 7938 (3994/3944) |  30% |    +416 |     -297 | 0.59 |   -28,981 | -681,222 |   682,024 |           26 | 1.3h
  MAIN Asia+EU 00-13 UTC               | 4341 (2127/2214) |  27% |    +417 |     -273 | 0.56 |   -25,607 | -379,579 |   380,948 |           35 | 1.5h
  Asia only 00-08                      | 2748 (1353/1395) |  27% |    +416 |     -262 | 0.59 |   +11,452 | -212,542 |   213,115 |           27 | 1.6h
  EU only 08-13                        | 1903 (929/974) |  26% |    +418 |     -280 | 0.51 |   -40,009 | -193,989 |   195,151 |           31 | 1.4h
  US only 13-21 (contrast)             | 3415 (1737/1678) |  33% |    +417 |     -324 | 0.62 |    -3,145 | -282,759 |   283,149 |           25 | 1.2h
  Asia+EU + force-close 13:00          | 4388 (2146/2242) |  22% |    +416 |     -229 | 0.54 |   -14,702 | -372,201 |   372,597 |           34 | 1.3h
  Asia+EU · engulf only                | 2698 (1333/1365) |  31% |    +417 |     -309 | 0.60 |   -12,859 | -233,153 |   234,447 |           35 | 1.8h
  Asia+EU · SMA200 trend               | 2908 (1467/1441) |  28% |    +417 |     -270 | 0.59 |    +3,438 | -233,252 |   233,444 |           28 | 1.6h

  % of account (1x, full account per trade)
  all sessions (baseline)              | gross sum   -31.1% · gross compounded   -32.5% (maxDD 40.7%) | net sum  -824.9% · net compounded  -100.0%
  MAIN Asia+EU 00-13 UTC               | gross sum   -32.4% · gross compounded   -30.5% (maxDD 36.6%) | net sum  -466.5% · net compounded   -99.1%
  Asia only 00-08                      | gross sum   +14.4% · gross compounded   +12.8% (maxDD 15.5%) | net sum  -260.4% · net compounded   -92.8%
  EU only 08-13                        | gross sum   -50.8% · gross compounded   -41.0% (maxDD 44.5%) | net sum  -241.1% · net compounded   -91.2%
  US only 13-21 (contrast)             | gross sum    +0.7% · gross compounded    -3.3% (maxDD 29.2%) | net sum  -340.8% · net compounded   -96.8%
  Asia+EU + force-close 13:00          | gross sum   -20.4% · gross compounded   -21.2% (maxDD 30.2%) | net sum  -459.2% · net compounded   -99.0%
  Asia+EU · engulf only                | gross sum   -16.9% · gross compounded   -18.0% (maxDD 30.0%) | net sum  -286.7% · net compounded   -94.5%
  Asia+EU · SMA200 trend               | gross sum    +3.1% · gross compounded    +0.4% (maxDD 13.2%) | net sum  -287.7% · net compounded   -94.5%

  Stop-loss trades (loss per 1 BTC, fees excluded / included; % = of entry price)
  all sessions (baseline)              | SL 5591 · avg $215 (net $297) · 0.27% · median $174 · p75 $274 · p90 $408 · max $2,614
  MAIN Asia+EU 00-13 UTC               | SL 3175 · avg $192 (net $273) · 0.24% · median $158 · p75 $237 · p90 $362 · max $2,614
  Asia only 00-08                      | SL 2000 · avg $181 (net $262) · 0.23% · median $153 · p75 $227 · p90 $338 · max $1,332
  EU only 08-13                        | SL 1417 · avg $200 (net $280) · 0.26% · median $159 · p75 $250 · p90 $383 · max $2,614
  US only 13-21 (contrast)             | SL 2304 · avg $242 (net $324) · 0.31% · median $197 · p75 $315 · p90 $463 · max $2,033
  Asia+EU + force-close 13:00          | SL 2908 · avg $184 (net $265) · 0.23% · median $152 · p75 $230 · p90 $342 · max $2,614 | time-exit 498 · avg +62
  Asia+EU · engulf only                | SL 1870 · avg $228 (net $309) · 0.29% · median $192 · p75 $285 · p90 $404 · max $1,225
  Asia+EU · SMA200 trend               | SL 2105 · avg $189 (net $270) · 0.24% · median $159 · p75 $246 · p90 $354 · max $1,046

  MAIN by year / side
    2024 LONG  trades 788 · TP  27% · net  -53,310 pts · PF 0.63
    2024 SHORT trades 768 · TP  24% · net  -64,162 pts · PF 0.55
    2025 LONG  trades 773 · TP  30% · net  -77,359 pts · PF 0.55
    2025 SHORT trades 852 · TP  30% · net  -90,468 pts · PF 0.53
    2026 LONG  trades 566 · TP  22% · net  -53,722 pts · PF 0.50
    2026 SHORT trades 594 · TP  27% · net  -40,558 pts · PF 0.62

  MAIN last 12 trades
    2026-09-28T12:15 LONG  @83,416.7 zone 83,210–83,296 TP 83,917 → SL  82,948.3 (09-28T14:40) net -552
    2026-09-29T00:35 SHORT @83,534.0 zone 83,534–83,637 TP 83,034 → TP  83,034.0 (09-29T01:10) net +417
    2026-09-29T02:00 SHORT @83,029.2 zone 83,100–83,210 TP 82,529 → SL  83,210.0 (09-29T03:25) net -264
    2026-09-29T03:30 LONG  @83,196.8 zone 83,100–83,156 TP 83,697 → SL  83,083.0 (09-29T03:50) net -197
    2026-09-29T05:55 LONG  @83,431.0 zone 83,296–83,296 TP 83,931 → TP  83,931.0 (09-29T06:30) net +416
    2026-09-29T07:15 SHORT @83,991.9 zone 84,045–84,045 TP 83,492 → SL  84,055.6 (09-29T07:30) net -148
    2026-09-29T07:45 SHORT @84,015.0 zone 84,045–84,045 TP 83,515 → SL  84,095.2 (09-29T08:15) net -164
    2026-09-29T08:45 LONG  @83,866.4 zone 83,820–83,820 TP 84,366 → SL  83,786.7 (09-29T09:05) net -163
    2026-09-29T10:40 SHORT @84,018.0 zone 84,045–84,045 TP 83,518 → SL  84,064.0 (09-29T10:50) net -130
    2026-09-29T11:50 LONG  @84,455.2 zone 84,333–84,381 TP 84,955 → SL  84,327.4 (09-29T12:10) net -212
    2026-09-29T12:15 SHORT @84,266.2 zone 84,333–84,381 TP 83,766 → SL  84,392.0 (09-29T12:35) net -210
    2026-09-29T12:55 SHORT @84,332.9 zone 84,333–84,381 TP 83,833 → SL  84,438.5 (09-29T13:05) net -190

```

Verdict: 4x more trades (no zone filter), TP hit 22-33%, fees (~83 pts/trade) destroy it: net -92% to -100% of account at 1x.

## M5 entries + M30 UT Bot (10,3) trend filter

### TP zone (args: ... 5m zone ut30)

```

  variant                              | trades (L/S) | TP% | avg win | avg loss |  PF  | gross pts | NET pts  | maxDD pts | max L-streak | avg hold
  all sessions (baseline)              | 889 (420/469) |  28% |    +564 |     -361 | 0.62 |   -11,282 |  -87,268 |    88,991 |           20 | 1.6h
  MAIN Asia+EU 00-13 UTC               | 453 (215/238) |  26% |    +541 |     -336 | 0.58 |    -8,306 |  -47,054 |    48,580 |           12 | 1.7h
  Asia only 00-08                      | 282 (130/152) |  26% |    +556 |     -332 | 0.58 |    -5,409 |  -29,587 |    31,521 |           14 | 1.9h
  EU only 08-13                        |  181 (91/90) |  27% |    +513 |     -354 | 0.54 |    -6,192 |  -21,637 |    23,300 |           12 | 1.3h
  US only 13-21 (contrast)             | 367 (173/194) |  33% |    +594 |     -412 | 0.70 |      +855 |  -30,549 |    39,185 |           12 | 1.3h
  Asia+EU + force-close 13:00          | 454 (215/239) |  21% |    +529 |     -277 | 0.53 |    -9,616 |  -48,434 |    50,135 |           19 | 1.4h
  Asia+EU · engulf only                | 234 (118/116) |  32% |    +528 |     -403 | 0.63 |    -3,661 |  -23,540 |    24,108 |           12 | 2.0h
  Asia+EU · SMA200 trend               | 345 (166/179) |  26% |    +551 |     -341 | 0.58 |    -7,239 |  -36,537 |    37,096 |           15 | 1.8h

  % of account (1x, full account per trade)
  all sessions (baseline)              | gross sum    -9.4% · gross compounded   -10.4% (maxDD 24.7%) | net sum   -98.3% · net compounded   -63.2%
  MAIN Asia+EU 00-13 UTC               | gross sum    -9.6% · gross compounded    -9.8% (maxDD 15.4%) | net sum   -54.9% · net compounded   -42.7%
  Asia only 00-08                      | gross sum    -4.5% · gross compounded    -4.8% (maxDD 14.8%) | net sum   -32.7% · net compounded   -28.2%
  EU only 08-13                        | gross sum    -9.4% · gross compounded    -9.2% (maxDD 14.2%) | net sum   -27.5% · net compounded   -24.3%
  US only 13-21 (contrast)             | gross sum    +5.4% · gross compounded    +4.6% (maxDD 17.0%) | net sum   -31.3% · net compounded   -27.5%
  Asia+EU + force-close 13:00          | gross sum    -9.4% · gross compounded    -9.5% (maxDD 14.0%) | net sum   -54.8% · net compounded   -42.5%
  Asia+EU · engulf only                | gross sum    -3.5% · gross compounded    -3.8% (maxDD 9.3%) | net sum   -26.9% · net compounded   -23.9%
  Asia+EU · SMA200 trend               | gross sum    -8.6% · gross compounded    -8.8% (maxDD 11.8%) | net sum   -43.1% · net compounded   -35.4%

  Stop-loss trades (loss per 1 BTC, fees excluded / included; % = of entry price)
  all sessions (baseline)              | SL 636 · avg $275 (net $361) · 0.34% · median $224 · p75 $359 · p90 $513 · max $3,518
  MAIN Asia+EU 00-13 UTC               | SL 333 · avg $250 (net $336) · 0.31% · median $208 · p75 $331 · p90 $472 · max $1,436
  Asia only 00-08                      | SL 210 · avg $245 (net $332) · 0.30% · median $211 · p75 $328 · p90 $464 · max $1,436
  EU only 08-13                        | SL 132 · avg $269 (net $354) · 0.34% · median $203 · p75 $359 · p90 $550 · max $1,303
  US only 13-21 (contrast)             | SL 247 · avg $325 (net $412) · 0.39% · median $288 · p75 $402 · p90 $583 · max $3,518
  Asia+EU + force-close 13:00          | SL 301 · avg $242 (net $328) · 0.30% · median $202 · p75 $323 · p90 $468 · max $981 | time-exit 57 · avg +78
  Asia+EU · engulf only                | SL 158 · avg $317 (net $403) · 0.39% · median $279 · p75 $383 · p90 $611 · max $981
  Asia+EU · SMA200 trend               | SL 254 · avg $256 (net $341) · 0.32% · median $212 · p75 $332 · p90 $472 · max $1,436

  MAIN by year / side
    2024 LONG  trades  63 · TP  27% · net   -6,235 pts · PF 0.59
    2024 SHORT trades  84 · TP  27% · net   -7,571 pts · PF 0.61
    2025 LONG  trades 104 · TP  20% · net  -17,754 pts · PF 0.38
    2025 SHORT trades 110 · TP  31% · net   -8,104 pts · PF 0.72
    2026 LONG  trades  48 · TP  27% · net   -3,111 pts · PF 0.67
    2026 SHORT trades  44 · TP  27% · net   -4,280 pts · PF 0.61

  MAIN last 12 trades
    2026-08-11T10:20 LONG  @64,228.0 zone 64,176–64,215 TP 64,888 → SL  64,144.0 (08-11T13:30) net -148
    2026-08-22T03:35 SHORT @78,685.3 zone 78,720–78,761 TP 77,722 → TP  77,722.1 (08-22T05:10) net +885
    2026-08-23T08:45 SHORT @76,494.1 zone 76,534–76,534 TP 75,546 → SL  76,579.2 (08-23T09:00) net -162
    2026-08-26T05:15 SHORT @78,752.0 zone 78,888–79,020 TP 78,121 → SL  79,022.0 (08-26T05:20) net -349
    2026-08-28T05:15 SHORT @79,630.0 zone 79,596–79,723 TP 78,928 → SL  79,731.5 (08-28T05:25) net -181
    2026-09-04T04:00 LONG  @80,855.2 zone 80,669–80,905 TP 81,288 → TP  81,288.0 (09-04T04:25) net +352
    2026-09-09T01:55 LONG  @78,891.5 zone 78,822–78,882 TP 79,463 → SL  78,802.5 (09-09T02:10) net -168
    2026-09-09T02:20 LONG  @78,826.0 zone 78,663–78,725 TP 79,463 → SL  78,649.2 (09-09T03:05) net -256
    2026-09-10T05:30 SHORT @78,476.6 zone 78,508–78,550 TP 77,952 → TP  77,952.0 (09-10T07:30) net +446
    2026-09-19T08:25 LONG  @81,298.0 zone 81,050–81,250 TP 81,741 → TP  81,741.0 (09-19T15:05) net +361
    2026-09-22T05:20 SHORT @85,243.5 zone 85,300–85,607 TP 84,130 → SL  85,900.0 (09-22T08:35) net -742
    2026-09-23T07:55 SHORT @86,124.8 zone 86,170–86,271 TP 85,569 → TP  85,569.5 (09-23T11:20) net +469

```

### TP fixed (args: ... 5m fixed ut30)

```

  variant                              | trades (L/S) | TP% | avg win | avg loss |  PF  | gross pts | NET pts  | maxDD pts | max L-streak | avg hold
  all sessions (baseline)              | 5248 (2581/2667) |  29% |    +417 |     -291 | 0.59 |   -11,513 | -440,027 |   440,027 |           24 | 1.4h
  MAIN Asia+EU 00-13 UTC               | 2816 (1397/1419) |  26% |    +418 |     -265 | 0.55 |   -19,832 | -248,305 |   249,131 |           26 | 1.5h
  Asia only 00-08                      | 1778 (848/930) |  26% |    +418 |     -256 | 0.57 |    -1,828 | -146,652 |   147,287 |           30 | 1.5h
  EU only 08-13                        | 1190 (625/565) |  26% |    +420 |     -274 | 0.55 |   -13,802 | -109,191 |   110,408 |           21 | 1.5h
  US only 13-21 (contrast)             | 2217 (1071/1146) |  34% |    +416 |     -326 | 0.66 |   +19,741 | -161,912 |   162,499 |           29 | 1.2h
  Asia+EU + force-close 13:00          | 2839 (1407/1432) |  21% |    +418 |     -221 | 0.53 |    -9,859 | -239,942 |   240,403 |           20 | 1.3h
  Asia+EU · engulf only                | 1701 (835/866) |  29% |    +419 |     -297 | 0.58 |   -12,640 | -150,473 |   151,316 |           24 | 1.7h
  Asia+EU · SMA200 trend               | 2136 (1073/1063) |  27% |    +418 |     -271 | 0.56 |   -11,405 | -185,974 |   186,430 |           21 | 1.5h

  % of account (1x, full account per trade)
  all sessions (baseline)              | gross sum   -13.9% · gross compounded   -17.6% (maxDD 29.9%) | net sum  -538.7% · net compounded   -99.6%
  MAIN Asia+EU 00-13 UTC               | gross sum   -19.7% · gross compounded   -19.9% (maxDD 30.9%) | net sum  -301.2% · net compounded   -95.2%
  Asia only 00-08                      | gross sum    +1.1% · gross compounded    -0.4% (maxDD 12.8%) | net sum  -176.7% · net compounded   -83.2%
  EU only 08-13                        | gross sum   -15.3% · gross compounded   -15.2% (maxDD 24.8%) | net sum  -134.3% · net compounded   -74.2%
  US only 13-21 (contrast)             | gross sum   +22.9% · gross compounded   +22.4% (maxDD 15.6%) | net sum  -198.8% · net compounded   -86.7%
  Asia+EU + force-close 13:00          | gross sum    -7.9% · gross compounded    -9.6% (maxDD 20.4%) | net sum  -291.8% · net compounded   -94.7%
  Asia+EU · engulf only                | gross sum   -12.9% · gross compounded   -13.6% (maxDD 25.0%) | net sum  -183.0% · net compounded   -84.3%
  Asia+EU · SMA200 trend               | gross sum   -12.2% · gross compounded   -13.2% (maxDD 20.4%) | net sum  -225.8% · net compounded   -89.8%

  Stop-loss trades (loss per 1 BTC, fees excluded / included; % = of entry price)
  all sessions (baseline)              | SL 3713 · avg $210 (net $291) · 0.27% · median $167 · p75 $271 · p90 $404 · max $2,614
  MAIN Asia+EU 00-13 UTC               | SL 2088 · avg $184 (net $265) · 0.23% · median $150 · p75 $234 · p90 $352 · max $2,614
  Asia only 00-08                      | SL 1321 · avg $174 (net $256) · 0.22% · median $145 · p75 $223 · p90 $328 · max $888
  EU only 08-13                        | SL 877 · avg $194 (net $274) · 0.25% · median $154 · p75 $249 · p90 $369 · max $2,614
  US only 13-21 (contrast)             | SL 1462 · avg $245 (net $326) · 0.31% · median $194 · p75 $325 · p90 $464 · max $1,576
  Asia+EU + force-close 13:00          | SL 1910 · avg $177 (net $258) · 0.23% · median $144 · p75 $224 · p90 $338 · max $2,614 | time-exit 322 · avg +75
  Asia+EU · engulf only                | SL 1206 · avg $216 (net $297) · 0.28% · median $182 · p75 $276 · p90 $385 · max $1,073
  Asia+EU · SMA200 trend               | SL 1566 · avg $189 (net $271) · 0.24% · median $156 · p75 $246 · p90 $360 · max $1,073

  MAIN by year / side
    2024 LONG  trades 496 · TP  22% · net  -41,561 pts · PF 0.54
    2024 SHORT trades 527 · TP  24% · net  -42,124 pts · PF 0.57
    2025 LONG  trades 521 · TP  28% · net  -57,431 pts · PF 0.50
    2025 SHORT trades 523 · TP  28% · net  -56,235 pts · PF 0.51
    2026 LONG  trades 380 · TP  24% · net  -31,349 pts · PF 0.55
    2026 SHORT trades 369 · TP  29% · net  -19,605 pts · PF 0.70

  MAIN last 12 trades
    2026-09-25T01:50 SHORT @84,544.0 zone 84,622–84,718 TP 84,044 → SL  84,853.0 (09-25T02:00) net -394
    2026-09-25T09:55 SHORT @84,570.0 zone 84,622–84,718 TP 84,070 → SL  84,728.6 (09-25T10:25) net -243
    2026-09-25T10:55 SHORT @84,713.7 zone 84,870–84,942 TP 84,214 → SL  85,075.2 (09-25T11:05) net -446
    2026-09-25T12:50 LONG  @84,449.6 zone 84,298–84,385 TP 84,950 → SL  84,268.7 (09-25T13:15) net -265
    2026-09-26T00:05 SHORT @84,088.0 zone 84,061–84,123 TP 83,588 → SL  84,136.0 (09-26T02:10) net -132
    2026-09-26T03:35 SHORT @84,008.0 zone 84,020–84,123 TP 83,508 → SL  84,270.0 (09-26T08:30) net -346
    2026-09-26T09:20 SHORT @83,996.5 zone 84,020–84,123 TP 83,497 → SL  84,152.0 (09-26T10:15) net -240
    2026-09-27T06:00 LONG  @84,504.0 zone 84,474–84,510 TP 85,004 → TP  85,004.0 (09-27T10:10) net +415
    2026-09-29T03:30 LONG  @83,196.8 zone 83,100–83,156 TP 83,697 → SL  83,083.0 (09-29T03:50) net -197
    2026-09-29T05:55 LONG  @83,431.0 zone 83,296–83,296 TP 83,931 → TP  83,931.0 (09-29T06:30) net +416
    2026-09-29T08:45 LONG  @83,866.4 zone 83,820–83,820 TP 84,366 → SL  83,786.7 (09-29T09:05) net -163
    2026-09-29T11:50 LONG  @84,455.2 zone 84,333–84,381 TP 84,955 → SL  84,327.4 (09-29T12:10) net -212

```

Verdict: trend filter cuts trades ~35-55% and trims losses, but gross is still negative for Asia+EU in both TP modes; net -42% (zone) / -95% (fixed).
