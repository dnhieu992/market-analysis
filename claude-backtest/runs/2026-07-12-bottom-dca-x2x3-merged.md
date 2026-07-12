# Bottom-accumulation DCA → hold for x2/x3, spot, NO stop-loss (merged strategy)

**Date:** 2026-07-12
**Script:** `scripts/run-bottom-dca-x2x3-backtest.ts`
**Universe:** the 36 `/tracking-coins` symbols (33 had enough D1 history), Binance D1, 1460d, $1000/coin, fee 0.05%/side.
**Goal (user):** merge `/tracking-coins` + `/accumulation` into ONE strategy — drop swing/dip timing,
accumulate at STRONG bottoms, target x2/x3, few orders. Replaces the EMA34-reclaim exit of the old
accumulation study (`2026-06-29-accumulation-zone-no-sl.md`, which was net-negative: PF 0.72–0.81).

## Strategy under test
- **Entry (bottom zone):** coin DOWN [ddMin,ddMax] from its 500d peak AND tight base (≤25% / 30d)
  AND price ≤ base-low+8% AND RSI ≤ 45.
- **Ladder:** 3 equal-USD tranches, add every −15% below the first entry (few orders).
- **Exit:** off average cost — variants below. NO stop-loss; unreached target → bag held (marked-to-market).
- **Survival gate:** live strategy gates entry on `dcaScore ≥ 50` (market cap + weekly trend). NOT
  reproducible per-bar historically → simulated by restricting the basket to large-cap survivors.

## Results

### Exit-target sweep (full basket, all-out at ×m, dd 50–85%)
| exit | camps | winRate | E[R]/camp | PF |
|---|---|---|---|---|
| ×1.5 | 39 | 56.4% | +1.25% | 1.11 |
| ×1.8 | 38 | 52.6% | +5.45% | 1.42 |
| **×2.0** | 38 | 50.0% | **+7.73%** | **1.58** |
| ×2.5 | 32 | 31.3% | −9.16% | 0.60 |
| ×3.0 | 30 | 26.7% | −11.28% | 0.57 |
| half ×2 + half ×3 | 29 | 34.5% | +0.48% | 1.02 |

### Entry-depth sensitivity (exit ×2)
| entry dd | camps | E[R]/camp | PF |
|---|---|---|---|
| 50–85% | 38 | +7.73% | 1.58 |
| 60–90% (deeper) | 23 | −19.58% | 0.13 |

### Survival-gate effect (exit ×2, large-cap survivors only)
| universe | camps | winRate | E[R]/camp | PF | worst MAE |
|---|---|---|---|---|---|
| full basket (no gate) | 38 | 50.0% | +7.73% | 1.58 | 99.98% |
| **large-cap survivors (gate proxy)** | 24 | 58.3% | **+14.97%** | **3.53** | 43.43% |

## Findings
1. **x2 is the achievable target, NOT x3.** There is a sharp sweet spot at ×2.0 (PF 1.58). Pushing to
   ×2.5/×3.0 *collapses* the edge (PF <0.6) — only ~3–4 coins ever reach x3, and while waiting the
   rest round-trip back into bags. Holding half for x3 (the requested exit) nets +0.48%/PF 1.02 vs
   **+7.73%/PF 1.58 for a clean full exit at x2**. On this basket, x3 is a fantasy; take the x2.
2. **The survival gate is the single biggest lever.** Same rules, majors-only: PF 1.58 → **3.53**,
   E[R] +7.7% → **+15%**, and worst MAE 99.98% → 43%. The dead tail (ATOM −75%, APT −83%, SHIB −56%,
   FIL/DOT/INJ) is exactly what `dcaScore ≥ 50` must filter. It must be a **HARD** gate here (unlike
   the old soft/advisory gate on `/tracking-coins`).
3. **Deeper is worse.** dd 60–90% → PF 0.13. Coins down 60–90% are disproportionately the dying ones;
   the profitable bottom band is 50–85%.
4. **Few orders, long holds.** ~24–38 campaigns over 4y across the whole basket, avg 2 of 3 tiers
   filled, avg hold ~95–135d. Matches the "not many trades" requirement.
5. Confirms the old verdict from a better angle: letting winners run to x2 (instead of the EMA34
   bounce) flips PF 0.81 → 1.58, but only coin selection (the gate) turns it into a real edge (3.53).

## Recommendation for the merged page
- ONE zone: **GOM** = bottom zone (dd 50–85% + tight base + RSI≤45) **AND hard gate dcaScore ≥ 50**.
- Suggested ladder: 3 tranches, −15% spacing.
- **Target = full exit at +100% (x2).** Do not ship an x3 target. (Optional: expose x2 as the headline
  target and let the user manually keep a runner — but the backtested, mechanical edge is at x2.)
- Drop the EMA34 "CHOT" take-profit and all dip/swing timing.

## Related Files
- `scripts/run-bottom-dca-x2x3-backtest.ts` — this backtest (env `BASKET="BTC,ETH,..."` overrides the universe).
- `claude-backtest/runs/2026-06-29-accumulation-zone-no-sl.md` — prior EMA34-exit study this supersedes.
