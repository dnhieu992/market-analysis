# Spot Scan — "find the next ZEC" (D1 screener)

**Date:** 2026-09-18
**Goal:** derive, from ZEC's real footprint, a repeatable D1 screener for old/beaten-down
projects entering a ZEC-like accumulation → breakout, and rank current candidates.

## ZEC template (measured)
- Low **$15.78** (2024-07-05) → ATH **$1,535** (2026-09-18) ≈ **+9,600% / ~97×** over 805 days.
- Base: price stayed **< 2× the low for ~100 days** before liftoff (tight accumulation).
- Liftoff footprint: **reclaim of the 200D SMA** from below, **30d volume ~2×** its average,
  then a **base breakout** (new 60d high) while still early (not parabolic).

## Screener — FUNDAMENTAL only (v2, scored 0–100)
Technical signals removed by request. Score = deep drawdown from ATH + low dilution (MC/FDV) +
high circulating %. Data: Binance `exchangeInfo` (universe) + CoinGecko `/coins/markets`
(mcap/FDV/ATH/supply). No klines. The qualitative layer (team/VC/tokenomics/unlocks) is manual DD.

### ZEC "backtest" (applying the fundamental criteria)
At the $15.78 low: −99.5% from its $3,191 ATH · hard 21M cap · ~73% mined, fair-launch (no VC unlock)
· ECC / Zooko / zk-SNARKs · privacy narrative · ~$267M cap → passed on fundamentals, then ran 97×.

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-spot-scan.ts 25 --min=30 --max=2000 --vol=2 --pool=350
```
Universe now comes from **CoinGecko `/coins/markets`** (thousands of coins, ranked by market cap,
filtered to a cap window + min volume) — true ATH drawdown + MC/FDV dilution + 30d momentum from
CoinGecko, merged with Binance-D1 technicals. Wrapped as the `spot-scan` Claude skill.

Market-cap guidance: default **$30M–$2B**. <$30M = dead/illiquid; $30–300M = highest asymmetry +
risk; $300M–$2B = survivors, 3–10×; >few $B = little room.

## Top candidates (2026-09-18, cap $50M–$1.5B, 120 pulled / 71 with Binance D1)
PYTH 96 · VET 95 · POL 94 · 1INCH 93 · ETC 93 · STRK 88 · EGLD 88 · DASH 88 · ZEN 88 · OP 88.
All: TRUE ATH drawdown −92…−99%, reclaimed 200D, volume surge. Low MC/FDV flagged as dilution
(OP 54%, JUP 48%, ARB 68%); over-extended flagged "late" (MINA +160%, ARB +195% off-low).

## Takeaway
The screener cleanly reproduces the ZEC setup and, in the current "old-coin revival" regime,
surfaces a coherent basket rather than noise. It is a **research filter, not an entry signal** —
technicals say *when* money is rotating back in, not *which* project deserves it (ZEC's 97× leaned
on a privacy narrative + supply lock). Next: (1) historical validation — do high-score coins
outperform forward? (2) surface the scan in-app / via Telegram.

Strategy record: "Spot Scan" on `/strategy` (content = this method + live candidate table).
