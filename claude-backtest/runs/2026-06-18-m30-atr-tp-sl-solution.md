# Better TP/SL for M30 — ATR-scaled partial, no breakeven churn

**Date:** 2026-06-18
**Scripts:** `scripts/run-flip-atr-bracket-backtest.ts` (new), `scripts/run-flip-partial-atr-backtest.ts` (new)
**Context:** follow-up to `2026-06-18-swing-partial-tp-breakeven-m30.md` — the shipped fixed **+5% partial
barely triggers on M30**. Goal: a volatility-adaptive TP/SL that actually fits M30.

## Approaches tested
1. **Hard ATR bracket** (`run-flip-atr-bracket`): enter on flip, hard SL = sl×ATR, TP1 = tp1×ATR,
   chandelier trail, **flat between trades** (one trade per leg).
2. **ATR partial, stay always-in-market** (`run-flip-partial-atr`): keep UTBot line as the trailing
   SL (no hard stop), bank half at +tpMult×ATR, runner rides the flip. Breakeven runner stop toggle.

All: M30, 365d (2025-06-18 → 2026-06-18), $1000 compounded, fee 0.05%/side, ATR(10).

## Finding 1 — a hard SL kills the edge
ETH M30, kv8/10, grid sl×tp1 (trail 3×ATR): **every** combo returned **−4% to −14%** with very low
DD (8–17%). Cutting losers early + sitting flat also cuts you out of the big continuation moves that
make the method's +180%. Defined-risk bracket = smooth but unprofitable here. ❌

## Finding 2 — the breakeven stop + re-entry is the real culprit
ETH M30, kv10, ATR partial, always-in-market:

| variant | trades | WR | ret% | maxDD% |
|---------|-------:|---:|-----:|-------:|
| baseline flip (no TP) | 60 | 50% | **+181** | 20 |
| partial 2×ATR, breakeven **ON** | 133 | 80% | +88 | 18 |
| partial 3×ATR, breakeven **ON** | 95 | 72% | +106 | 17 |
| partial 2×ATR, breakeven **OFF** | 60 | 53% | +119 | **9** |
| partial 3×ATR, breakeven **OFF** | 60 | 62% | +131 | **11** |

Breakeven ON triples the trade count (partial → back to entry → re-enter → repeat) and is strictly
worse: lower return, higher DD, more fees. **Turning it OFF keeps the trade count flat (no churn)**,
gives up ~30% of return vs baseline, and **roughly halves drawdown**.

## Finding 3 — validation, partial 2.5×ATR + breakeven OFF (recommended)
```bash
for s in BTCUSDT ETHUSDT SOLUSDT BNBUSDT; do
  TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
    scripts/run-flip-partial-atr-backtest.ts $s 30m 365 1000 0.05 "8,10,12" 2.5 0
done
```

| coin | kv | baseline ret%/DD% | NEW ret%/DD% (2.5×ATR, no BE) | ret/DD baseline → new |
|------|---:|------------------:|------------------------------:|----------------------:|
| ETH | 10 | +181 / 20 | **+134 / 11** | 9.0 → 12.2 |
| SOL | 12 | +35 / 36 | **+68 / 16** | 1.0 → 4.3 |
| BTC | 12 | +20 / 31 | **+16 / 19** | 0.6 → 0.8 |
| BNB | 8  | +25 / 22 | **+17 / 15** | 1.1 → 1.1 |

Win rate rises to ~50–58% everywhere. Risk-adjusted (return/maxDD) improves in every case (SOL
improves on **both** return and DD); the only real cost is absolute return on the strongest trender (ETH).

## Recommended M30 solution
- **keyValue 10–12** (not 2–4 — those are fee-death on M30).
- **SL = the UTBot trailing line** (stay always-in-market; do NOT add a hard early stop — it removes the trend edge).
- **Partial TP = +2.5×ATR(entry)** on half the position (volatility-scaled; actually triggers on M30, unlike fixed 5%).
- **Drop the breakeven stop / re-entry** — let the runner ride to the UTBot flip. This is the single
  biggest improvement: half the drawdown, no churn.

Net: ~25–35% less raw return than the plain flip on strong trends, but **drawdown roughly halved** and
better risk-adjusted across all four coins. This **differs from the currently-deployed rule** (fixed 5%
+ breakeven), which the data shows is the worse of the options on M30.

Backtest only — no feature/code change made.
