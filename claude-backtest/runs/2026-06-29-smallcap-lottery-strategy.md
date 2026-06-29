# Small-cap "lottery" spot strategy — basket + oversold entry + TP ladder

## Goal
User buys these mid/small-caps as **lottery tickets** (small flat size vs main book).
So: no compounding, accept dump risk per ticket, rely on basket diversification +
asymmetric upside + a take-profit ladder + a time stop. Backtest a concrete ruleset.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-smallcap-lottery-strategy-backtest.ts
```

## Config
- Data: Binance D1 ~2.7y, 33-coin basket (ATM/PIVX/ORDI + 30 small-caps).
- Sizing: **flat $100/ticket** (no compounding). Bankroll = $100 × 33 coins = $3,300.
- Entry: oversold capitulation. One open ticket per coin (no pyramiding). Buy at signal-day close.
- Exit: scale-out ladder + time stop; optional disaster stop. Fee 0.05%/side per leg.

## Results
| cfg | entry | ladder / hold / stop | tickets | win | mean/ticket | worst | total on $3,300 |
|-----|-------|----------------------|---------|-----|-------------|-------|------------------|
| A | deep | 50%@+15 / +30, 14d, no stop | 144 | 73% | +4.3% | −88% | +19% |
| B | deep | 50%@+20 / +40, 21d, no stop | 141 | 66% | +5.9% | −93% | **+25%** |
| **C** | **deep** | **50%@+15 / +30, 21d, stop −40%** | 157 | 70% | +4.6% | **−40%** | +22% |
| D | relaxed | 50%@+15 / +30, 14d, no stop | 468 | 54% | +1.5% | −80% | +21% |
| E | deep | 33%@+15 / +50, 30d, no stop | 136 | 65% | +4.9% | −93% | +20% |
| F | deep | buy&hold, exit close +14d (benchmark) | 143 | 69% | +1.8% | −88% | +8% |

Deep entry = RSI<30 & close<EMA200 & ≥25% drop/10d. Relaxed = RSI<35 & ≥15% drop/10d.

Per-coin (relaxed cfg D): ATM 11 tickets +7.6% mean; PIVX 16 tickets −1.2%; ORDI 16 tickets +2.3%.

## Takeaway
- **The TP ladder is the edge.** Buy&hold the same oversold signal (F) = +8%; adding the
  scale-out ladder ≈ **3×** the return (+19–25%). These coins dump fast, so locking +15–20%
  early is what converts pumps into realized PnL. Don't diamond-hand.
- **Quality entry beats more entries.** Deep oversold (A/B/C) wins 66–73% at +4–6%/ticket.
  Relaxing the entry to catch ATM (D) quadruples ticket count but win rate falls to 54% and
  mean/ticket to +1.5% — over-trading dilutes the edge. PIVX was net negative on relaxed.
- **Cap the tail with a −40% disaster stop (cfg C).** No-stop configs have −88% to −93%
  worst tickets — a handful of failed pumps that keep bleeding eat most of the basket's gain.
  The −40% stop barely dents total return (+22% vs +25%) but turns the worst ticket from a
  near-zero into −40%. For a lottery sleeve this is the sane default. **Survivorship warning:**
  the universe is coins still listed today — real delisted zeros make the tail worse, so the
  stop matters even more live.
- **Magnitude is modest:** ~+20–25% on the whole lottery bankroll over ~2.7y ≈ **7–9%/yr**,
  with individual tickets occasionally +22–38%. It's a small uncorrelated asymmetric sleeve,
  not a jackpot machine. Flat sizing across the basket is what keeps any single −40% survivable.

## Recommended ruleset (cfg C, lottery sleeve)
1. **Universe:** a basket of ~20–35 liquid Binance small-caps (incl. ATM/PIVX/ORDI). Never one coin.
2. **Entry:** when a coin closes with RSI(14)<30 **and** below EMA200 **and** ≥25% down over 10 days → buy.
3. **Sizing:** equal flat $ per ticket; one ticket per coin at a time; only risk the lottery sleeve.
4. **Take profit:** sell **½ at +15–20%**, sell the **rest at +30–40%**.
5. **Disaster stop:** hard exit if it falls **−40%** from entry (caps the zeros).
6. **Time stop:** if neither TP nor stop hits within **~21 days**, sell at close and recycle the cash.
