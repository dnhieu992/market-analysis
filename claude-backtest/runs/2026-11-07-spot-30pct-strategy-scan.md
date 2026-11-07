# Spot +30%/leg strategy scan (2026-11-07)

Goal (user): spot only, buy, take ~+30% per leg, no stop-loss. Independent of the app's tools.

## Data
- Binance daily candles 2018-01 → 2026-11: 70 live coins (watchlist + large alts) **+ 41 delisted/dead
  coins** from data.binance.vision (LUNA, FTT, WAVES, SRM, XMR, OMG, REN, WTC, LTO, …) to cut
  survivorship bias. Old LUNA cut at its May-2022 death; COCOS (1000:1) and DREP (100:1)
  redenominations fixed. Delisted coin = forced sale at last close.
- Fear & Greed (alternative.me) from 2018.

## Step 1 — per-signal edge (buy at close, exit at +30%, 30-day cooldown per coin)
Compared with random entry in the same half-year and BTC regime (BTC above/below SMA200) = EDGE.

| signal | n | +30% ≤180d | stuck 365d | EDGE |
|---|---|---|---|---|
| random (every day) | 172k | 70% | 23% | 0 |
| **RSI weekly < 35 OR RSI daily < 25** | 1280 | **83%** | **11%** | **+11** |
| RSI weekly < 30 | 279 | 86% | 7% | +12 |
| RSI daily < 20 | 153 | 87% | 8% | +14 |
| drawdown ≥50% from 180d high | 2402 | 74% | 21% | +3 |
| breakout 60d base + vol×2 | 460 | 80% | 14% | +5 |
| Donchian 20/50 breakout, EMA50 cross, golden cross | — | 69–74% | 20–25% | −1…+2 |
| Pullback to EMA50 in uptrend | 1329 | 61% | 29% | −7 |
| Fear & Greed < 20 / < 25 | — | 68–69% | 25% | −2…−3 |

RSI-oversold edge is positive in **every year 2018–2025** (+3 … +31); trend/breakout signals flip
negative in 2019/2022. Matches the literature note that crypto shows short-horizon reversal.

## Step 2 — portfolio simulation (the real test)
Capital split in N slots, one position per coin, buy 30/30/40 at signal / −15% / −30%, TP at
avg × 1.30, no stop, fee 0.1%/side, dead coins included.

| setup (CAGR / max DD) | 2019→2026 | 2019→2022 | 2023→2026 |
|---|---|---|---|
| Hold BTC | 46% / −77% | 45% / −77% | 48% / −53% |
| RSI dip, **all 110 coins**, 10 slots | 4% / −62% | 5% / −62% | 23% / −48% |
| RSI dip, **top-10 by 30d volume**, 5 slots | **33% / −29%** | 25% / −29% | 26% / −20% |
| RSI dip, top-15, 5 slots | 32% / −31% | 32% / −28% | 23% / −31% |
| RSI dip, top-20, 8 slots | 22% / −29% | 22% / −29% | 25% / −24% |
| RSI dip, top-30, 8 slots | 16% / −37% | 20% / −37% | 25% / −36% |
| Random entries, top-20, 5 slots (median 7 seeds) | 11% / −65% | 17% / −65% | 5% / −58% |

Findings:
1. Per-trade hit rate looks great everywhere, but portfolio return is driven by **stuck positions**
   (no stop → a −90% coin locks a slot for years) and **idle cash in bull markets** (oversold signals
   don't fire in 2020–21). Universe quality is the biggest lever: only liquid top-10/20 coins work.
2. Ladder matters: single entry 8%/−74% vs 0/−15/−30 ladder 17%/−36% (top-20, 5 slots).
3. TP +20–30% best; +40–50% much worse (more stuck capital).
4. Adding momentum entries helps 2019–22 but loses in 2023–26 → not robust.
5. Results are parameter-sensitive (top-10…30 → 13…33% CAGR): expect ~15–30%/yr with DD ~−30%,
   i.e. **lower CAGR than holding BTC but ~half the drawdown**. Capital used only ~40% of the time.
6. Stuck examples at the end of the run: ICP, FIL, GALA bought in 2022 never recovered +30%.

## Proposed rules
- Universe: only coins in the top ~15–20 by 30-day spot volume (or top market cap), listed ≥ 1 year.
- Entry signal: RSI(14) weekly < 35 OR RSI(14) daily < 25 (closed candles).
- Ladder per coin: 30% at signal, 30% at −15%, 40% at −30% from the first fill.
- TP: avg × 1.30 (sell all). No stop. One position per coin; capital in 5–8 slots.
- Stuck rule: after 365 days without TP, review (rotate if coin left top-20 / fundamentals broke).
- Idle cash is expected in bull markets (keep it in BTC/stable as you prefer).

Scripts: claude-backtest/scripts/spot-30pct/ (fetch.py, fetch_dead.py, lib.py, scan.py, refine.py, byyear.py, sim.py, grid.py, final.py).
