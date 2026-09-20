# Sonic R BTC day-trade v2 — more setups, multi-timeframe, and long-vs-short (2024→now)

Follow-up to `2026-09-20-sonicr-btc-daytrade-multitf.md`. User asked: try more scenarios,
add **multi-timeframe** analysis, and answer **"why only long, no short?"**.

## What's new vs v1
- **3 setups:** `dragon` (pullback into EMA34 band) · `river` (pullback to EMA89) · `breakout` (close beyond prior-20-bar extreme, in trend).
- **Multi-timeframe (MTF) trend gate** — the Sonic-R "triple screen": require the higher TF's stacked trend to agree, using only the last **closed** higher-TF bar (no lookahead). `htf ∈ none / 4h / 1d / 4h&1d`.
- **2 exits:** fixed RR=3 · ATR trailing stop (2×ATR from high-water).
- **Session filter:** all hours · active (12–22 UTC, EU+US).
- **Long and short tracked separately.**
- 192 configs (4 entry TF × 3 setup × 4 htf × 2 exit × 2 session). Fee 0.05%/side, risk $10, no overnight.
- Scripts: `claude-backtest/scripts/sonicr-v2.mjs`, robustness `sonicr-verify2.mjs`.

## Why only LONG, no SHORT

Every SYMMETRIC trend-pullback config, long side vs short side (same setup, opposite direction):

| config (1h dragon, fixed, all hours) | side | trades | WR | PF | net$ |
|---|---|---:|---:|---:|---:|
| htf = 1d      | **LONG** | 236 | 48% | **1.24** | **+208** |
| htf = 1d      | SHORT | 96 | 40% | **0.81** | −81 |
| htf = 4h&1d   | **LONG** | 203 | 48% | **1.24** | **+181** |
| htf = 4h&1d   | SHORT | 77 | 40% | **0.90** | −31 |
| htf = 4h      | **LONG** | 278 | 47% | 1.12 | +125 |
| htf = 4h      | SHORT | 214 | 40% | 0.97 | −25 |

The pattern is consistent across **every** dragon config: **long PF 1.12–1.24 (profitable), short PF 0.77–0.97 (loses).**
Reason: BTC drifted strongly **up** across 2024→now, and a day trade **closes at end of session** — so a
short is fighting the up-drift every single day. The only setup where shorts don't bleed is pure `breakout`
without an HTF filter (short PF ~1.04, +$20), and even there it's marginal. **Shorting this market intraday is
paying to fight the trend.** Long-only isn't a bias I imposed — it's what the data pays for.

## Best configs (combined, n≥100, expR>0)

| # | config | trades | WR | PF | net$ | maxDD |
|--:|---|---:|---:|---:|---:|---:|
| 1 | **1h dragon htf=4h&1d fixed** | 280 | 46% | **1.14** | +149 | **8R** |
| 2 | 1h dragon htf=1d fixed | 332 | 46% | 1.10 | +128 | 12R |
| 3 | 30m dragon htf=4h&1d fixed | 336 | 40% | 1.07 | +121 | 15R |
| 4 | 1h breakout htf=none fixed | 435 | 43% | **1.15** | +155 | 13R |
| 5 | 30m dragon htf=1d fixed | 449 | 41% | 1.05 | +121 | 27R |

Fixed RR3 beat the ATR trail everywhere; the active-session filter didn't add edge.

## Multi-timeframe is the real improvement

Best net$ per (entry TF × htf gate):

| entry TF | none | 4h | 1d | 4h & 1d |
|---|---:|---:|---:|---:|
| 5m  | −2272 | −712 | −862 | −443 |
| 15m | −379 | −179 | −185 | −43 |
| 30m | −65 | −72 | **+121** | **+121** |
| 1h  | +155 | +101 | +128 | **+149 (DD 8R)** |

- **5m/15m still lose** even with the MTF gate — intraday noise + fees can't be filtered away. Drop them.
- **The MTF gate RESCUES 30m** (a v1 loser) into positive, and roughly **halves 1h drawdown** (v1 14.8R → v2 **7–8R**) by refusing counter-trend chop.

## Robustness — MTF makes the edge steadier (and self-protecting)

Long-only, dragon, SL=1ATR, RR=3, split by year:

**A) 1h · htf = 4h & 1d** — ALL: n=207, PF 1.24, +$184, maxDD **7.1R**
| year | trades | WR | PF | net$ |
|---|---:|---:|---:|---:|
| 2024 | 121 | 49% | **1.30** | +128 |
| 2025 | 86 | 49% | **1.17** | +57 |
| 2026 | **0** | — | — | — |

**B) 30m · htf = 1d** — ALL: n=327, PF 1.17, +$263, maxDD 15R (2024 PF 1.23 / 2025 PF 1.09 / 2026 none).

Two things matter here:
1. Unlike v1 (whose edge was **all** 2024, flat in 2025), the MTF gate keeps **2025 genuinely positive** (PF 1.17). Filtering by the big-picture trend improved the honest edge, not just the backtest optics.
2. **2026 produced ZERO trades** — the 1d stacked-bull gate was never satisfied, so the system stood aside for BTC's non-trending 2026. That's the filter *protecting capital*, but it also means **right now (2026) this strategy is dormant** — it will not fire until BTC's daily trend stacks bullish again.

## Recommendation

**Best day-trade scenario found:**
> **BTC 1h, LONG-only, Sonic-R Dragon pullback, gated by 4h AND 1d both stacked-bull.**
> Enter on the reclaim of a pullback into EMA34 (bullish 1h close back above EMA34); SL = pullback low − 1×ATR;
> target 3R; **close by end of session (no overnight).** ~PF 1.24, maxDD ~7R, ~0.3 trades/day.

- Use `30m · htf=1d` if you want more trades / more net$ (PF 1.17, +$263) at ~2× the drawdown.
- **Never short, never counter-trend, never below 30m** — all tested worse; 5m/15m lose outright.
- Honest framing: this is a **thin, trend-gated timing edge** (PF ~1.2), not a money machine. It only works
  while BTC's daily/4h trend is clearly up, and **sits out** otherwise (as it does in 2026). Best used as the
  intraday entry-timing layer on top of the daily macro-journal read, taking longs only when both the higher
  timeframes and the 1h pullback line up.

---
*BTCUSDT spot, Binance, 2024-01-01→2026-09-20, fee 0.05%/side, risk $10/trade, no overnight.
Scripts: `claude-backtest/scripts/sonicr-v2.mjs`, `sonicr-verify2.mjs`.*
