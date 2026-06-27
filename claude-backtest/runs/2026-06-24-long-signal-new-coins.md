# 2026-06-24 — Long-Signal page rule, backtest 19 new coins

## Rule of the `/long-signal` page (as deployed)

**LONG-only intraday FOMO, gated by the M30 UTBot trend.** Source: `apps/worker/src/modules/long-signal/long-signal.service.ts` + `LongSignalSettings` defaults in `packages/db/prisma/schema.prisma`.

- **Entry (00:00 UTC = 07:00 VN):** look at the **last CLOSED 30m candle**. If its UTBot trend is **bull** (`close > stop`), open a **LONG** at fixed notional. **Bear → skip** (UTBot is a gate, not a reversal). One entry per coin per day.
- **Take-profit:** +2% above entry.
- **Catastrophe stop:** −5% (wide LIVE safety net only).
- **Force-close (08:00 UTC = 15:00 VN):** market-close anything still open.
- **UTBot:** Wilder **ATR(10)** trailing stop, `nLoss = keyValue × ATR`, **keyValue = 1**.
- **Sizing:** fixed **$50** notional/coin/day, 5× leverage, **no compounding**.
- Default live basket: `POLUSDT, XRPUSDT, SOLUSDT, TAOUSDT`.

## Command

```bash
SYMBOLS="SOLUSDT,SUIUSDT,XRPUSDT,POLUSDT,ADAUSDT,LINKUSDT,TAOUSDT,DOGEUSDT,SHIBUSDT,\
SEIUSDT,HBARUSDT,BNBUSDT,ONDOUSDT,LTCUSDT,AAVEUSDT,AVAXUSDT,TONUSDT,OPUSDT,TIAUSDT" \
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-long-fomo-m30utbot-filter-backtest.ts 365 0.05 50 2 8 1 10 0
```

Config: 365d · fee 0.05%/side · $50/trade · TP +2% · exit 08:00 UTC · kv 1 · ATR 10 · entry 00:00 UTC.

## Results (net = after 0.05%/side fee)

| symbol | trades | skip | TP hit | forced | winRate | GROSS $ | NET $ | net/trade |
|--------|-------:|-----:|-------:|-------:|--------:|--------:|------:|----------:|
| POLUSDT  | 201 | 164 | 64 | 137 | 61.2% | +27.80 | **+17.73** | +0.09 |
| XRPUSDT  | 163 | 202 | 38 | 125 | 61.3% | +23.86 | **+15.68** | +0.10 |
| DOGEUSDT | 183 | 182 | 56 | 127 | 58.5% | +16.54 | **+7.38**  | +0.04 |
| SOLUSDT  | 182 | 183 | 47 | 135 | 58.8% | +15.58 | **+6.47**  | +0.04 |
| TAOUSDT  | 173 | 192 | 74 |  99 | 61.3% | +10.58 | **+1.92**  | +0.01 |
| ONDOUSDT | 187 | 178 | 64 | 123 | 59.4% | +10.73 | **+1.37**  | +0.01 |
| LTCUSDT  | 186 | 179 | 34 | 152 | 58.1% |  +8.86 |  −0.45 | −0.00 |
| ADAUSDT  | 165 | 200 | 49 | 116 | 55.8% |  +5.70 |  −2.55 | −0.02 |
| BNBUSDT  | 204 | 161 | 27 | 177 | 57.4% |  +6.97 |  −3.24 | −0.02 |
| HBARUSDT | 176 | 189 | 58 | 118 | 51.7% |  +3.22 |  −5.59 | −0.03 |
| SUIUSDT  | 172 | 193 | 55 | 117 | 56.4% |  +2.29 |  −6.31 | −0.04 |
| TONUSDT  | 176 | 189 | 42 | 134 | 58.5% |  +2.20 |  −6.60 | −0.04 |
| LINKUSDT | 178 | 187 | 45 | 133 | 55.1% |  +1.58 |  −7.32 | −0.04 |
| AVAXUSDT | 182 | 183 | 50 | 132 | 57.1% |  +1.04 |  −8.06 | −0.04 |
| SHIBUSDT | 182 | 183 | 35 | 147 | 56.0% |  +1.68 |  −7.42 | −0.04 |
| TIAUSDT  | 168 | 197 | 64 | 104 | 54.8% | −10.52 | −18.91 | −0.11 |
| AAVEUSDT | 176 | 189 | 53 | 123 | 52.8% | −11.29 | −20.08 | −0.11 |
| OPUSDT   | 174 | 191 | 60 | 114 | 52.3% | −13.33 | −22.01 | −0.13 |
| SEIUSDT  | 181 | 184 | 57 | 124 | 52.5% | −16.26 | −25.29 | −0.14 |

**TOTAL:** 3409/6935 taken (3526 skipped bear) · TP hit 972 · forced 2437 · winRate 56.8% · **GROSS +$87.24 · NET −$83.26 · −$0.02/trade**.

## Takeaway

Over the last year the full 19-coin basket is roughly **break-even gross and net-negative after fees** at $50/trade — fees alone (~$0.05/round-trip × 3409 trades ≈ $170 drag) eat the small gross edge. The edge is **highly coin-dependent, not universal**: only 6 of 19 are net-positive. The four existing live coins validate well — **POL (+17.73), XRP (+15.68), SOL (+6.47), TAO (+1.92)** are all positive — and **DOGE (+7.38)** and **ONDO (+1.37)** are the only new names worth adding. The clear losers to avoid are **SEI, OP, AAVE, TIA** (each −$18 to −$25, win rate ≤53%). Recommendation: do **not** add the basket wholesale; if expanding the live set, consider adding only **DOGE** (and optionally ONDO), and keep the others off.
