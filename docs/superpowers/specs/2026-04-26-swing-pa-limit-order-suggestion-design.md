# Swing PA — Limit Order Suggestion When All Setups Skip

**Date:** 2026-04-26
**Status:** Approved

---

## Problem

`SwingPaReviewService` sends Claude both the active market setup and `pendingLimitSetups` from the analyzer. The current system prompt only says "review the setups strictly" without explicitly instructing Claude to:

1. Review each item in `pendingLimitSetups` and populate `limitSetupReviews`
2. Propose a replacement limit order when all provided limit setups are judged `skip`

As a result, when no limit setups pass review, the user receives no actionable limit order suggestion.

---

## Goal

When Claude reviews a Swing PA analysis and all `pendingLimitSetups` are `skip` (or the list is empty), Claude must propose at least one replacement limit order derived from the best S/R zone in the provided data.

---

## Design

### Scope

Single file change: `apps/worker/src/modules/analysis/swing-pa-review.service.ts`

- Update the `system` prompt string
- No schema changes, no type changes, no formatter changes

### System Prompt Changes

Add two explicit instructions after the existing review criteria:

**Instruction 1 — explicit limit review:**
> "For each item in `pendingLimitSetups`, add a corresponding entry to `limitSetupReviews`. Apply the same R:R ≥ 2 and zone quality (≥2 touches) criteria as for active setups."

**Instruction 2 — fallback when all skip:**
> "If all limit setups are judged `skip`, or `pendingLimitSetups` is empty, you MUST add at least one replacement limit order to `limitSetupReviews` with `verdict: 'adjusted'`. Choose the strongest support or resistance zone from `srZones` in the analysis data. Provide `adjustedEntry` [low, high], `adjustedSl`, `adjustedTp1`, and a `reason` explaining the zone selection. Respond in Vietnamese."

### Logic Flow

```
pendingLimitSetups has at least 1 valid/adjusted
  → limitSetupReviews shows normally (no change)

pendingLimitSetups all skip, or empty
  → Claude adds 1+ entry to limitSetupReviews
     verdict: 'adjusted'
     adjustedEntry / adjustedSl / adjustedTp1 from srZones
     reason in Vietnamese
  → formatter renders it as a normal limit order
    (formatSetupReview already handles 'adjusted' verdict)
```

### Why No Schema/Formatter Changes Needed

`SwingPaSetupReview` already has:
- `verdict: 'valid' | 'adjusted' | 'skip'`
- `adjustedEntry: [number, number]`
- `adjustedSl: number`
- `adjustedTp1: number`
- `reason: string`

`formatSetupReview` in `swing-pa-formatter.ts` already renders all adjusted fields when present. The replacement suggestion is semantically equivalent to an "adjusted" setup — same shape, same rendering.

---

## Related Files

- `apps/worker/src/modules/analysis/swing-pa-review.service.ts` — system prompt update (only change)
- `apps/worker/src/modules/analysis/swing-pa-formatter.ts` — no change (already handles adjusted verdict)
- `apps/worker/src/modules/analysis/swing-pa-analyzer.ts` — no change (srZones already included in analysis JSON)
