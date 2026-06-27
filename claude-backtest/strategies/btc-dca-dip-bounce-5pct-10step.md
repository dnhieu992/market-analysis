# Strategy spec — BTC DCA dip-bounce (start −5%, 10 tranches, TP +10%)

> Implementation-ready spec. Mechanic: ladder into dips below a frozen local peak, sell the whole
> position once price bounces +10% above the blended cost, then reset and wait for the next dip.

## 1. Parameters (final)

| Param | Value |
|---|---|
| Symbol / timeframe | BTCUSDT spot, 1D candles |
| First entry tier | −5% below the local peak |
| Number of tranches | 10 |
| Step between tiers | 1.5% |
| **Tier levels (% below peak)** | −5 / −6.5 / −8 / −9.5 / −11 / −12.5 / −14 / −15.5 / −17 / −18.5 |
| Tranche size | 1/10 of the cycle budget each (equal) |
| Take-profit | sell **100%** of position at **avg cost × 1.10** (+10%) |
| Stop loss | **none** — only exit is the TP |
| Order type | **limit** orders (resting buys at each tier; one TP sell, repriced after each fill) |
| Fees assumed | 0.05% / side |
| Slippage assumed | 0.05% / side |
| Capital mode | compounded (reinvest profit) — see §5 for the flat alternative |

## 2. Algorithm (pseudocode)

```
peak = first candle high
inPosition = false
firedTiers = {}            # which of the 10 tiers have filled this cycle

on each new closed 1D candle c:
    if not inPosition:
        peak = max(peak, c.high)          # track the running peak ONLY while flat

    # --- take profit first (cannot fill on the same candle as an entry) ---
    if inPosition and c.high >= avgCost * 1.10:
        sell 100% at avgCost * 1.10
        realize PnL
        inPosition = false
        firedTiers = {}
        peak = c.high                      # restart dip-watch from the bounce
        # cancel any unfilled buy limits

    # --- ladder entries ---
    for i in 0..9:
        if i in firedTiers: continue
        level = peak * (1 - TIER[i])       # TIER = [0.05, 0.065, ... 0.185]
        if c.low <= level:                 # limit buy at `level` fills
            if not inPosition:
                cycleBudget = currentEquity   # (or fixed $1000 in flat mode)
                inPosition = true
            spend = cycleBudget / 10
            buy `spend` worth at price `level`
            recompute avgCost (cost-weighted, incl. fees+slippage)
            firedTiers.add(i)
            # reprice the TP sell limit to new avgCost * 1.10
```

**Key implementation details**
- **The peak FREEZES once the first tranche fills.** All 10 tier levels are measured from the peak
  reached *before* the dip began, not from a moving peak. Peak only resumes tracking after a TP sell.
- **No same-candle round-trip:** a tranche bought on a candle cannot be TP-sold on that same candle.
  Live this is automatic — you only know `avgCost` (and thus the TP price) after the buy fills, so
  the TP limit can only catch a *later* candle's move.
- After a TP sell, **cancel all unfilled buy limits** and re-arm fresh ones from the new peak.
- `avgCost` is the fill-weighted average **including fees & slippage**, so the +10% TP is a true
  net-of-cost target.

## 3. Worked sizing example ($1000 cycle budget)
Each tranche = **$100**. If price falls the full ladder (−18.5% from peak), all $1000 is deployed
across the 10 levels; blended cost ≈ −11.75% below peak; TP fires when price rebounds to ≈ avg×1.10.

## 4. Backtest results (FAIR fills, fee 0.05% + slippage 0.05% per side)

In-sample (IS) = 2017-08-17 → 2022-12-31. Out-of-sample (OOS) = 2023-01-01 → 2026-06-27.

| | IS return | OOS return | Max drawdown | Time in cash (OOS) | Cycles (OOS) |
|---|---|---|---|---|---|
| **This strategy (compounded)** | **+322%** | **+284%** | ~82% / 48% (IS/OOS) | 4% | 47 |
| This strategy (flat $1000/cycle) | +210% | +156% | — | — | — |
| Buy & Hold (benchmark) | +286% | +264% | 83% / 52% | — | — |

→ Compounded, it **beats Buy & Hold in BOTH periods** (the only config family that did), but only by
a **thin margin** (OOS +284% vs +264%).

## 5. ⚠️ Honest caveats — read before implementing
1. **The edge is small and fragile.** It beats buy & hold by ~+20% over 3.5 years OOS, *only when
   compounded*. In **flat $1000/cycle mode it returns +156% OOS and LOSES to buy & hold (+264%)**.
   The outperformance comes mostly from staying ~96% invested AND reinvesting profit — i.e. it
   behaves almost like buy & hold with extra steps.
2. **Drawdown is NOT reduced.** Expect ~80% peak-to-trough in a bear market, same as just holding.
   There is no stop loss; in a deep bear you are fully deployed and hold through it.
3. **Regime-dependent.** The mechanic needs frequent dips. A naive 200-DMA trend filter *backfired*
   (sold the bottoms). Going too shallow (start −3/−4%) also hurt OOS. −5% start was the sweet spot.
4. **Slippage-sensitive.** Higher-frequency variants bleed to slippage; this 10-tranche/TP+10 config
   does ~47 cycles → keep fees+slippage low (limit/maker orders) or the edge erodes.
5. **No leverage, spot only.** Results exclude funding; do not run this leveraged.

## 6. Implementation checklist
- [ ] State machine: `FLAT` (tracking peak, buy limits armed) ↔ `IN_POSITION` (TP limit armed).
- [ ] Persist: `peak`, `firedTiers`, `avgCost`, `position size`, `cycleBudget`, `realizedPnL`.
- [ ] Place 10 resting limit buys on entering FLAT; reprice the single TP sell after every fill.
- [ ] On TP fill: realize PnL, cancel unfilled buys, reset peak to current price, go FLAT.
- [ ] Decide capital mode: **compounded** (use current equity as cycleBudget) or **flat $1000**.
- [ ] Handle restart/crash recovery from persisted state (don't double-fire tiers).
- [ ] Paper-trade first; verify fills match the limit-order assumption before risking capital.

## 7. Reproduce the numbers
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-dca-tranches-oos.ts BTCUSDT          # IS/OOS table
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-dca-compound-vs-flat.ts BTCUSDT      # compounded vs flat
```
See also: `claude-backtest/runs/2026-06-27-btc-dca-oos-validation.md` (the overfitting story).
