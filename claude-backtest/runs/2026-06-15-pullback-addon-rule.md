# 2026-06-15 — Pullback add-on rule (scale-in toward UTBot line)

## New rule tested
On top of the base flow (UTBot stop-and-reverse on candle close, always in market), add:
- While in a trend, when the candle **CLOSE** comes back to within **1%** of the UTBot stop
  line, open **one more position in the trend direction** (symmetric: bull→add long,
  bear→add short).
- **Re-arm:** an add can only fire again after price moves **>1%** away from the line and
  returns inside it. **Max 3 adds per trend leg.**
- All positions (base + adds) close on the next confirmed flip, then reverse.

## Config
- Sizing: **flat $100 per leg** (base and each add-on), no compounding — PnL reported in $.
- Indicator: UTBot, ATR period **10**, keyValue swept 1–4
- Period: 365 days (2025-06-15 → 2026-06-15)
- Fee: **0.05%/side**. Band **1%**, maxAdds **3**.
- Script: `scripts/run-flip-pullback-backtest.ts` (prints BASELINE vs WITH ADD-ON).

## Command
```bash
for sym in BTCUSDT ETHUSDT BNBUSDT DOGEUSDT SUIUSDT; do
  for tf in 4h 1d; do
    TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
      scripts/run-flip-pullback-backtest.ts $sym $tf 365 0.05 "1,2,3,4" 1 3 100
  done
done
```

## Results — Δ add-on$ = (WITH add-on netPnl) − (baseline netPnl), per $100/leg

| Symbol | TF | kv1 Δ | kv2 Δ | kv3 Δ | kv4 Δ |
|---|---|---|---|---|---|
| BTC | 4h | +11.49 | +4.29 | −16.39 | **+57.18** |
| BTC | 1d | +7.62 | −12.29 | −10.44 | **+11.77** |
| ETH | 4h | +34.68 | **+67.09** | **+95.42** | −7.00 |
| ETH | 1d | +12.36 | −16.92 | −26.46 | 0.00 |
| BNB | 4h | −84.68 | −2.32 | −54.07 | **+105.37** |
| BNB | 1d | +17.39 | +15.63 | −10.65 | −7.28 |
| DOGE | 4h | +84.16 | +7.23 | −64.82 | +19.85 |
| DOGE | 1d | +78.03 | −5.16 | −4.79 | 0.00 |
| SUI | 4h | +4.59 | −40.36 | −9.61 | **+116.76** |
| SUI | 1d | +73.22 | −38.48 | −12.22 | −4.82 |
| **Σ Δ (all)** | | **+238.86** | **−21.29** | **−114.03** | **+291.83** |

Selected absolute jumps at the strong configs (baseline → with add-on netPnl):
- **BNB 4h kv4:** $66.20 → **$171.56** (maxDD $29) — best config got ~2.6×.
- **SUI 4h kv4:** $66.70 → **$183.46** (maxDD $47).
- **BTC 4h kv4:** $10.86 → **$68.04** (maxDD $33).
- **ETH 4h kv2:** $70.96 → **$138.04**; **ETH 4h kv3:** $42.14 → $137.56.
- **DOGE 4h kv1:** $106 → **$190.59**; **DOGE 1d kv1:** $17.77 → **$95.80**.

## Takeaway
**The add-on rule is an amplifier, not a fixer — its sign depends almost entirely on
keyValue.** Aggregated across all 10 symbol/TF runs it is strongly net-positive at
**kv=4 (+$292)** and **kv=1 (+$239)**, but net-negative at **kv=2 (−$21)** and clearly
bad at **kv=3 (−$114)**.

Why: scale-ins fire *near the stop line*, exactly where a flip is most likely. In **clean,
long trends** (high keyValue → few, long legs) those near-line entries ride big runs and
the extra exposure pays off **with contained drawdown** (kv=4 maxDD mostly $18–47). In
**choppy regimes** (mid keyValue → many whipsaws) the same near-line entries get flipped
immediately and bleed fees + losses, and they also inflate maxDD ($75–198).

**Recommendation: enable the pullback add-on ONLY on high-keyValue / clean-trend configs
(kv=4), which are the same configs already flagged as robust (e.g. BNB kv=4).** There it
boosts the best setups ~2–2.6× with little extra drawdown. Do **not** run it on kv=2/3
configs. kv=1 also benefits on aggregate but carries large add-on drawdowns ($150–163 on
BTC/ETH/BNB 4h) and one bad outlier (BNB 4h kv1 −$85) — treat kv=1+add-on as
higher-variance, not a clean win.

Note on win rate: add-ons always *lower* win rate (more marginal near-line entries) even
when they raise PnL — judge this rule on net PnL and drawdown, not hit-rate.

Caveats: single year / single regime; flat $100 sizing (no compounding); excludes slippage
and funding; "max 3 concurrent adds" means up to $400 notional exposure in a trend, so the
$ figures are not directly comparable to the earlier $1000-compounded runs.
