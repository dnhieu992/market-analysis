# Small-cap pump — low-risk entry study (ATM / PIVX / ORDI + 30 small-caps)

## Goal
User: small-caps (ATM, PIVX, ORDI) pump hard then dump fast — find the strong-pump
pattern and a **low-risk buy point**. Measure both upside AND downside, not just upside.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-smallcap-pump-entry-backtest.ts
```

## Config
- Data: public Binance **D1**, last ~1000 candles (~2.7y) per coin.
- Universe: ATM, PIVX, ORDI + 30 small-caps (DGB, SC, ZEN, NKN, BAND … VITE) = 33 coins, all with data.
- Metrics per signal-day, forward 14d / 30d:
  - **UP** = max forward gain = `max((high[j]-c)/c)` (the pump we could catch)
  - **MAE** = max adverse excursion = `min((low[j]-c)/c)` (how far underwater first = RISK)
  - **up/risk** = `|median UP / median MAE|`
- No SL/TP simulated here — this is a *signal-quality* study (where to buy), not a trade engine.

## Part A — pump characterisation (confirms "pump then dump")
| coin | pumps ≥50%/14d (2.7y) | median pump | median give-back 14d after peak | med daily move |
|------|----|------|------|------|
| **ATM**  | 8  | +55% | **−32%** | 1.8% |
| **PIVX** | 15 | +63% | **−42%** | 2.9% |
| **ORDI** | 9  | +52% | **−29%** | 3.5% |
| basket avg | ~9 | ~58% | ~−32% | ~2.7% |

→ Pumps are frequent and big (~55–63% median), but **~30–42% is given back within 14 days of the peak**. Chasing green candles is a losing entry. Buy the crash, not the rip.

## Part B — signal comparison (whole universe, 25,960 baseline days)
| signal | n | 14d UP med | 14d MAE med | **14d up/risk** | 30d up/risk |
|--------|---|-----------|-------------|-----------------|-------------|
| BASELINE (any day) | 25960 | +11% | −13% | 0.83 | 0.78 |
| **Oversold deep** — RSI<30 & <EMA200 & drop≥25%/10d | 431 | **+19%** | **−12%** | **1.60** | 1.29 |
| Oversold relaxed — RSI<35 & <EMA200 & drop≥15%/10d | 2213 | +14% | −11% | 1.26 | 0.97 |
| Oversold extreme — RSI<25 & drop≥35%/14d | 117 | +22% | −19% | 1.16 | 0.78 |
| Beaten-down — DD≥70% from 365d peak & RSI<40 | 5237 | +11% | −12% | 0.98 | 0.97 |
| Capitulation+vol — RSI<30 & drop≥20%/7d & vol≥2× | 184 | +19% | −14% | 1.33 | 1.22 |
| Pullback-to-EMA50 in uptrend | 1836 | +10% | −15% | 0.68 | 0.50 |

**Winner = "Oversold deep".** Best risk-adjusted upside (1.60 vs 0.83 baseline) AND the shallowest downside (median MAE only −12%). "Extreme" has higher mean upside but its downside tail is ugly (42% of signals drop ≤−35% first) — not low-risk. Buying **uptrend pullbacks is worse than random (0.68)** on these coins — they don't trend, they spike.

## Part C — recommended rule on the 3 named coins
"Oversold relaxed" (universal coverage incl. low-vol ATM, which rarely triggers the deep rule):
| coin | signals | 14d UP med | reach +15/+25/+40% | MAE med | %≤−20% |
|------|---------|-----------|--------------------|---------|--------|
| ATM  | 34 | +15% | 44% / 9% / 3%  | −6%  | 24% |
| PIVX | 87 | +14% | 45% / 16% / 8% | −14% | 31% |
| ORDI | 78 | +14% | 44% / 22% / 10% | −13% | 28% |

## Takeaway / actionable rule
- **Entry (low risk): buy into oversold capitulation, not the pump.** Primary rule = `RSI(14) < 30` **AND** `close < EMA200` **AND** `≥25% drop over 10 days`. This nearly doubled risk-adjusted upside vs baseline (1.60 vs 0.83) with median downside of only −12%. For low-vol coins like ATM that rarely hit it, relax to `RSI<35 / ≥15% drop` (smaller size).
- **Exit: take profit fast, don't hold.** Median pump is ~+55% but ~30–40% is given back within 14d of the peak. From a signal, ~44% of the time price reaches **+15%** within 14d, but +25% only ~10–22% and +40% is rare. So scale out the bulk at **+15–20%**, leave a small runner. No "diamond hands."
- **Reject:** uptrend EMA50-pullback entries (worse than random) and "extreme" RSI<25 dips (deep −35% drawdowns before the bounce).
- Caveat: signal-quality study (forward stats), not a full SL/TP trade engine; excludes slippage/fees. Survivorship: universe is coins still listed on Binance today.
