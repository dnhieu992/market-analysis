## Description
DCA (Dollar Cost Averaging) planning tool. Users define a budget for a coin, generate an LLM-powered plan with 10 buy zones and 10 sell zones, each scored with a probability estimate. Budget tracks gross buys only — sell proceeds are profit, not reclaimed budget.

## Main Flow
1. User creates a DCA config (coin + budget + portfolio link).
2. User clicks "Generate Plan" — API fetches candles, calls Claude with capital state, receives 10 buy + 10 sell zones with probability scores.
3. Plan displayed in two sections: Buy Zones / Sell Zones. Click a row to expand the note.
4. User executes/skips/edits items. Executed items create portfolio transactions.
5. User can Re-plan (new plan, preserving history) or Re-analyze (update market commentary only).

## Budget Logic
- `deployedAmount = sum(buy transactions)`
- `remaining = totalBudget - deployedAmount`
- Sell proceeds are tracked as profit in the portfolio, not added back to DCA budget.

## Probability Scoring
Each plan item has a `probability` (0–100):
- 70–100 → green badge
- 40–69 → amber badge
- 0–39 → red badge
LLM assigns score based on zone distance from current price and strength of S/R level.

## Edge Cases
- If LLM returns null, API returns `{ error: string }` and UI shows error message.
- Notes are hidden by default; click row to expand.
- Soft-deleted LLM items (deletedByUser=true) are excluded from UI but kept for LLM context on re-plan.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/dca/dca.service.ts` — capital state calculation
- `apps/api/src/modules/dca/dca-llm.service.ts` — LLM plan generation with probability
- `apps/api/src/modules/dca/dca-plan.service.ts` — plan CRUD, execute items
- `apps/api/src/modules/dca/dca.controller.ts` — REST endpoints
- `apps/web/src/widgets/dca-panel/dca-panel.tsx` — panel header, capital display, action buttons
- `apps/web/src/widgets/dca-panel/plan-items-table.tsx` — buy/sell sections, probability badge, expandable notes
- `apps/web/src/widgets/dca-panel/add-edit-item-modal.tsx` — add/edit item with probability field
- `apps/web/src/widgets/dca-panel/execute-modal.tsx` — execute item dialog
- `packages/db/prisma/schema.prisma` — DcaConfig, DcaPlan, DcaPlanItem models
