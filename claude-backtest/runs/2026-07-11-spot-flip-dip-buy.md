# Spot-Flip dip-buy strategy backtest — 2026-07-11

Backtest of the **/spot-flip** strategy (dip-buy mean reversion), **not** the UTBot flow.
Goal: does the tool's mechanical entry/exit have a tradeable edge?

## Strategy (as encoded, mirrors the tool)
On daily candles, at the close of day `t` compute over the last 30 candles [t-29..t]:
- `high30d`, `pullbackPct = (high30d − close)/high30d × 100`
- `ATR% = avg((high−low)/close × 100)` over the last 14 candles
- `dipDepth = pullbackPct / ATR%`

**Entry**: long at `close[t]` when flat and `dipDepth ≥ threshold` and `pullbackPct > 0`
(the tool's "canh mua nhịp hồi" stance fires at dipDepth ≥ 1).
**Exit**: `TP = entry × (1 + tpMult·ATR%)`, `SL = entry × (1 − slMult·ATR%)` — tool defaults
tpMult 0.8, slMult 0.6. First touch from day t+1 wins; if a day trades through BOTH, assume
**SL first** (conservative). Optional forced close at day close after `maxHold` days.
One position at a time, $1000 fully compounded, fee **0.05%/side** (0.10% round-trip).

## Commands
```bash
# default sweep (thresholds 0.5/1/1.5/2), 730d
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-spot-flip-backtest.ts <SYMBOL> 730 1000 0.05 0.8 0.6 30 "0.5,1,1.5,2"
# wider-TP variant
... scripts/run-spot-flip-backtest.ts <SYMBOL> 730 1000 0.05 2.0 1.0 20 "1"
```
Window: 2024-06-07 → 2026-07-11 (765 daily candles).

## Results — default config (TP 0.8×ATR, SL 0.6×ATR, maxHold 30d)

| Symbol | Buy&Hold | thresh | trades | win% | TP/SL/MH | avgHold | return% | maxDD% |
|--------|---------:|-------:|-------:|-----:|:--------:|--------:|--------:|-------:|
| BTC | **+10.4%** | 0.5 | 219 | 46 | 100/119/0 | 2.1d | +5.9% | 31.6% |
| BTC |  | 1.0 | 198 | 44 | 88/110/0 | 2.0d | **−11.7%** | 29.4% |
| BTC |  | 2.0 | 147 | 40 | 59/88/0 | 1.9d | −34.4% | 42.6% |
| ETH | **−41.3%** | 1.0 | 200 | 45 | 89/111/0 | 2.2d | −4.7% | 43.4% |
| ETH |  | 2.0 | 160 | 44 | 71/89/0 | 2.1d | +4.0% | 35.9% |
| SOL | **−45.4%** | 1.0 | 211 | 41 | 87/124/0 | 2.0d | −53.6% | 66.1% |
| BNB | **+10.1%** | 1.0 | 204 | 42 | 85/119/0 | 2.1d | −40.5% | 47.5% |
| XRP | **+147.0%** | 1.0 | 209 | 41 | 85/124/0 | 2.2d | **−57.9%** | 67.4% |

## Results — wider-TP variant (TP 2.0×ATR, SL 1.0×ATR, maxHold 20d, thresh 1.0)

| Symbol | trades | win% | TP/SL/MH | avgHold | return% | maxDD% |
|--------|-------:|-----:|:--------:|--------:|--------:|-------:|
| BTC | 97 | 35 | 31/62/4 | 5.7d | −13.2% | 53.8% |
| ETH | 95 | 31 | 27/64/4 | 6.1d | −58.3% | 67.1% |
| SOL | 102 | 32 | 30/68/4 | 5.5d | −46.4% | 66.9% |

## Takeaway
**The mechanical spot-flip dip-buy strategy has no edge — it is net-negative on every coin
tested and badly underperforms buy&hold.** At the tool's own default (threshold 1.0, TP 0.8×
/ SL 0.6× ATR) it returns −12% (BTC), −5% (ETH), −54% (SOL), −40% (BNB), −58% (XRP) over the
last two years. Win rate sits at ~40–46%, just around the ~43% break-even for a 0.8/0.6 R:R,
so the ~0.10% round-trip fee across ~200 trades/2yr tips it negative. The deeper problem is
**upside capping**: the tight ATR take-profit sells winners at +2–3% and the strategy then
re-enters/gets stopped, so in strong uptrends (XRP +147%, BNB/BTC +10%) it turns a big gain
into a big loss. Widening the TP (2.0×/1.0×) only drops the win rate to ~31–35% and stays
negative. Conclusion: the /spot-flip page is useful as **manual decision-support** (where the
coin sits in its range, a realistic ATR-based TP, and the fee-net R:R calculator) but the
dip-depth stance is **not** a standalone auto-trading signal.

Caveats: daily-close fills only; same-day TP+SL resolved pessimistically as SL; no slippage,
no partial fills, single position at a time, long-only. Real results land between this
(SL-first) and a TP-first optimistic bound, but the sign and magnitude are consistent enough
across 5 coins and 2 exit configs to be robust.
