# BTC SHORT · Asian-session S/R-channel fade (M30) · TP $500 · exit 16:00 UTC

**Date:** 2026-09-27
**Period:** 2024-01-01 → 2026-09-27 (~1000 days), public Binance klines
**Fee:** 0.05%/side (0.1% round-trip) · $1000/trade fixed (+ $1000-compounded equity shown)

## Strategy tested
- **Direction:** short only.
- **Level:** M30 **S/R channel** — confirmed pivot highs (swing high = max over `piv` bars each side, no look-ahead) clustered into a zone when within `chanW%` of each other; the **nearest zone above the 00:00 price** is the active resistance, its **lower edge** the short trigger.
- **Entry window:** Asian session **00:00–06:00 UTC**. Limit-short fills when an M30 candle's high tags the zone lower edge (one entry/day).
- **TP:** entry − **$500** (absolute price points). **No stop.**
- **Force-close:** **16:00 UTC** open if TP not hit.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-btc-short-asia-srchannel-m30-backtest.ts
# args: [startISO] [tpPts] [piv] [chanW%] [minTouch] [entryStart] [entryEnd] [exitHour] [fee] [notional]
```

## Results

| piv | chanW% | touch | TP$ | trades | TP hit | TP% | forced(green) | GROSS | fees | **NET** | net/trd | $1k→eq | maxDD |
|----:|-------:|------:|----:|-------:|-------:|----:|--------------:|------:|-----:|--------:|--------:|-------:|------:|
| **10** | 0.5 | 1 | **500** | 817 | 528 | 65% | 289(42) | −$125 | −$817 | **−$942** | −$1.15 | $366 | 63.7% |
| 5 | 0.5 | 1 | 500 | 894 | 561 | 63% | 333(47) | −$386 | −$893 | −$1,280 | −$1.43 | $259 | 74.3% |
| 20 | 0.5 | 1 | 500 | 706 | 475 | 67% | 231(33) | +$199 | −$706 | −$507 | −$0.72 | $571 | 50.5% |
| 10 | 0.5 | 2 | 500 | 756 | 479 | 63% | 277(40) | −$223 | −$756 | −$978 | −$1.29 | $355 | 64.7% |
| 10 | 0.5 | 1 | 300 | 817 | 659 | 81% | 158(8) | +$388 | −$817 | −$429 | −$0.53 | $628 | 42.3% |
| 10 | 0.5 | 1 | 700 | 817 | 437 | 53% | 380(77) | −$266 | −$817 | −$1,082 | −$1.32 | $312 | 69.2% |

## Takeaway
**No edge — the strategy loses money in every configuration.** The high TP-hit rate (63–81%) is a trap: it's the classic small-win / large-loss profile. The ~35% of trades that *don't* hit TP are the days BTC rallies straight through resistance and keeps going, and the forced-close loss at 16:00 UTC on those days dwarfs the capped +$500 wins — so even **gross** P&L is only ~breakeven (best case +$199 over 706 trades ≈ +$0.28/trade). Once the 0.1% round-trip fee is applied to ~800 trades, every variant is firmly negative and $1000 compounds *down* to $259–$628 with 42–74% drawdowns. Structurally this is fading resistance in a market that trended strongly **up** across 2024–2026, which is the wrong side. The least-bad knobs were a **longer pivot period** (piv=20 → fewer, stronger levels, −$507) and a **tighter TP=300** (81% hit, −$429), but neither reaches profitability. A stop-out on adverse breaks would cut the tail losers but can't manufacture edge from a mean-revert-short thesis in an uptrend; if this idea is pursued, gate it behind a **1D bear filter** (only short when the daily trend is down) — see `run-btc-short-0400-bearfilter-backtest.ts` for that pattern.
