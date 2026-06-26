# 2026-06-26 — Verify BTC win count on /tracking-coins page

## Why
User noticed BTC on `14.225.220.202:3001/tracking-coins` shows a "good" number of winning
orders (the *Lịch sử tín hiệu* tab) and asked to double-check whether that edge is real.

The page's history is just the swing orders auto-generated on each scan since tracking
started — a small, recent sample. To verify, I ran the walk-forward harness that reuses the
exact production order logic (`computeSwingLimitOrder` + `evaluateLimitOrder`).

## Commands
```bash
pnpm --filter worker backtest:orders -- --days=90  --symbols=BTC
pnpm --filter worker backtest:orders -- --days=365 --symbols=BTC
pnpm --filter worker backtest:orders -- --days=730 --symbols=BTC
```
Config: SWING only, D1 regime gate + asymmetric LONG filter (StrongUp only), ATR-based SL,
minRR not gated. **Gross of fees** (limit fills, 0.05%/side not applied). Expired = flat 0R.

## Results (BTC swing)

| Window | Filled | W/L | Expired | Win% (resolved) | E[R] | PF | MDD |
|--------|-------:|-----|--------:|----------------:|-----:|----:|-----:|
| 90d  | 50  | 16/20  | 14  | 44.4 | +0.233 | 1.58 |  -8.5R |
| 365d | 171 | 47/60  | 64  | 43.9 | +0.148 | 1.42 | -13.5R |
| 730d | 350 | 80/147 | 123 | 35.2 | +0.006 | 1.01 | -32.5R |

By side (365d): LONG 6/14, win 30%, **E[R] −0.096 (net loser)**; SHORT 41/46, win 47%, E[R] +0.221.
Same pattern in every window — all the profit comes from the SHORT side.

## Takeaway
The "good win count" is mostly a **recency + small-sample artifact**. Across every window the
**win rate is below 50%** (35–44%); the system is only net-positive because winners run ~1.5R+
while losers are −1R, and only in favourable regimes. Over a full 2 years it is essentially
**break-even (PF 1.01, E[R] ≈ 0) with a −32R drawdown**. Longs are a net loser throughout —
the edge is entirely the SHORT book during BTC's down/range stretches. Plus ~37% of filled
orders expire flat, and these numbers are **gross of fees**. Bottom line: the page's recent BTC
wins are real but not evidence of a durable edge; don't extrapolate the recent streak.
