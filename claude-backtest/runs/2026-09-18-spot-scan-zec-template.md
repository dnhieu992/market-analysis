# Spot Scan — "find the next ZEC" (D1 screener)

**Date:** 2026-09-18
**Goal:** derive, from ZEC's real footprint, a repeatable D1 screener for old/beaten-down
projects entering a ZEC-like accumulation → breakout, and rank current candidates.

## ZEC template (measured)
- Low **$15.78** (2024-07-05) → ATH **$1,535** (2026-09-18) ≈ **+9,600% / ~97×** over 805 days.
- Base: price stayed **< 2× the low for ~100 days** before liftoff (tight accumulation).
- Liftoff footprint: **reclaim of the 200D SMA** from below, **30d volume ~2×** its average,
  then a **base breakout** (new 60d high) while still early (not parabolic).

## Screener (5 traits, scored 0–100)
1. Deep drawdown from ATH (≥ 60–70%).
2. Tight multi-month base near the lows (range max/min < ~2×).
3. Regime flip: reclaimed the 200D SMA within ~30d.
4. Volume expansion (30d avg ≥ 1.3–2× prior).
5. Base breakout (60d high) but still early (+15…+150% off the 180d low; >150% flagged "late").

## Command
```bash
TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-spot-scan.ts 25 [symbolsCsv?]
```

## Top candidates (2026-09-18, 57 coins scored)
KAVA 90 · BAND 87 · SUSHI 86 · VET 86 · ANKR 86 · DOT 85 · ETC 83 · 1INCH 82 · ZRX 82 · THETA 80.
All: deep ddATH (−60…−86%), reclaimed 200D, tight base, volume 1.7–2.8×, still early off the lows.
DASH (privacy cohort) ranks ~22. ONE (+214%) / MINA (+161%) flagged "late".

## Takeaway
The screener cleanly reproduces the ZEC setup and, in the current "old-coin revival" regime,
surfaces a coherent basket rather than noise. It is a **research filter, not an entry signal** —
technicals say *when* money is rotating back in, not *which* project deserves it (ZEC's 97× leaned
on a privacy narrative + supply lock). Next: (1) historical validation — do high-score coins
outperform forward? (2) surface the scan in-app / via Telegram.

Strategy record: "Spot Scan" on `/strategy` (content = this method + live candidate table).
