# Swing new method (+5% partial TP + breakeven runner) on M30

**Date:** 2026-06-18
**Script:** `scripts/run-flip-partial-backtest.ts` (new)

## What was tested
Backtest the **new swing rule** just shipped to the worker, on the **M30 (30m)** timeframe,
side by side against the **baseline flip** (UTBot stop-and-reverse on close, no TP):

- **Baseline:** UTBot trend stop-and-reverse on candle CLOSE, always in market, no fixed TP.
- **New method:** same entries, but once price runs **+TP%** from entry, close **half** at the
  +TP level (intra-candle) and ratchet SL to **breakeven (entry)**. The remaining half rides the
  UTBot trail and exits on the trend flip, or at breakeven if price trades back to entry. A
  breakeven stop-out re-enters in the same direction on the next candle if the trend still holds.

Assumptions: trend flip is close-based (the UTBot signal); the partial TP and breakeven stop fill
**intra-candle** at their price levels (optimistic vs the live worker, which acts only on candle
close). Fees = open(full) + partial-close(half) + final-close(half) = **2×0.05% per trade**; a
breakeven stop-out + re-entry pays an extra round-trip. No leverage / funding / slippage. $1000 compounded.

## Commands
```bash
# main sweep, TP=5% (the shipped value), all four swing coins
for s in BTCUSDT ETHUSDT SOLUSDT BNBUSDT; do
  TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
    scripts/run-flip-partial-backtest.ts $s 30m 365 1000 0.05 "2,3,4,5,6" 5
done

# TP sensitivity on BTC/ETH (2% and 3%)
for tp in 2 3; do for s in BTCUSDT ETHUSDT; do
  TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
    scripts/run-flip-partial-backtest.ts $s 30m 365 1000 0.05 "3,4,5,6" $tp
done; done
```
Data: 17,520 M30 candles, **2025-06-18 → 2026-06-18**.

## Results — TP=5% (shipped value), M30, fee 0.05%/side, $1000

`ret%` = net return; `prt` = #partials fired; `be` = #breakeven stop-outs.

| coin | kv | baseline ret% / DD% | NEW ret% / DD% | prt | be |
|------|---:|--------------------:|---------------:|----:|---:|
| BTC | 5 | -32 / 42 | **-26 / 34** | 34 | 0 |
| BTC | 6 | -20 / 37 | **-9 / 32** | 34 | 2 |
| ETH | 4 | -20 / 45 | **+1 / 29** | 72 | 8 |
| ETH | 5 | **+58** / 32 | +43 / 30 | 57 | 4 |
| ETH | 6 | **+102** / 36 | +75 / 31 | 51 | 5 |
| SOL | 3 | -21 / 43 | **-14 / 39** | 92 | 2 |
| SOL | 5 | **-11** / 51 | -16 / 50 | 62 | 3 |
| BNB | 6 | +9 / 37 | **+14 / 34** | 43 | 4 |

(low kv 2–3 are hundreds of trades/year and net losers for both — omitted for brevity.)

## Results — TP sensitivity (smaller TP triggers far more often)

ETH M30, kv6: baseline +102% (39.7% WR) →
- TP=5%: **+75%**, WR 42.7%, 51 partials
- TP=3%: **+46%**, WR 50.6%, 79 partials
- TP=2%: **+35%**, WR 59.6%, 118 partials, 64 breakevens

## Follow-up — higher keyValue is the real lever on M30

```bash
for s in BTCUSDT ETHUSDT SOLUSDT BNBUSDT; do
  TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
    scripts/run-flip-partial-backtest.ts $s 30m 365 1000 0.05 "6,8,10,12,14" 5
done
```

| coin | kv | baseline ret%/DD% | NEW ret%/DD% | note |
|------|---:|------------------:|-------------:|------|
| BTC | 10 | +4 / 25 | **+18 / 21** | new wins |
| BTC | 12 | +20 / 31 | **+26 / 25** | new wins |
| ETH | 8  | **+140** / 30 | +108 / 24 | baseline ret, new lower DD |
| ETH | 10 | **+181** / 20 | +160 / 17 | new WR 50→60%, lower DD |
| SOL | 8  | -8 / 34 | **+10 / 32** | new flips to profit |
| SOL | 12 | +35 / 36 | **+41 / 28** | new wins, big DD cut |
| BNB | 8  | +24 / 22 | **+38 / 16** | new wins |
| BNB | 12 | -49 / 63 | **-17 / 40** | new much better |

At **kv 10–12** M30 becomes net-positive and the partial/breakeven overlay now **helps** more often
than it hurts (cleaner trends → it banks a real winner while the runner rides) — the opposite of the
kv 2–6 picture. Sweet spot ≈ **kv10 (ETH) … kv12 (BTC/SOL/BNB)**; kv14 starts decaying (too few signals).

## Takeaway
On **M30 the new partial/breakeven rule does not improve the strategy** — it trades return for a
smoother curve. At the shipped **TP=5%** the partial rarely fires (~30–90×/yr) because M30 trend
legs seldom run a full 5% before the UTBot flips, so results sit within a few % of baseline:
slightly **lower max-drawdown** and a small edge at high keyValue (BTC kv6 −20%→−9%, ETH kv4
−20%→+1%), but it **caps the rare big winners** that actually make trend-following profitable
(ETH kv5 +58%→+43%, kv6 +102%→+75%). Lowering TP makes this worse: TP=2% lifts win rate to
~50–60% but **halves total return** and adds breakeven whipsaw. Separately, **M30 itself is a poor
fit** for this method — only ETH kv5–6 (and marginally BNB kv6) are net-positive after 0.05% fees;
everything else loses to noise + trade frequency. **Recommendation:** keep the partial rule for the
4h/1d swing pairs it was designed around; if ever run on M30, prefer a *large* TP (so it rarely
interferes) or no partial at all. No code/feature change made — backtest only.
