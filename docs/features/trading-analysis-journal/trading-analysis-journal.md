## Description
The `/trading-analysis` page (route renamed from `/strategy-backtest`) is a daily analysis journal: the
trader writes, each day, the reasoning behind their trading — how they read the chart, why they did/didn't
take a trade, how they manage and monitor open orders. It reuses the `/journal` machinery (per-day markdown
entry, Claude auto-format on save, intra-day revision history, images, tags) but stores its entries in a
**separate corpus** (`scope = STRATEGY_BACKTEST`) so this "trading analysis" data stays distinct from the
general trading journal.

The purpose is a clean, labelled dataset so Claude can later learn to clone the trader's analysis +
trade-monitoring behaviour.

> History: the page originally also hosted a manual setup board (create setup → 5-min scan job scores
> fill/TP/SL). That board was removed from the UI on 2026-09-17 at the user's request; the page is now
> the analysis journal only. The setup **backend is intentionally kept** — the API module
> (`/strategy-backtest/*`), the worker scan cron, and the `strategy_backtest_setups` table all still run,
> and the FE widget (`widgets/strategy-backtest/`) is left in place (unused) so the board can be restored.

## Main Flow
1. Trader opens `/trading-analysis`. The server component fetches the journal entries for scope
   `STRATEGY_BACKTEST` (plus today's intra-day revisions) and renders the `TradingJournal` widget.
2. Trader writes the day's analysis in the markdown editor and clicks **Lưu / Cập nhật**.
3. The text is reformatted via `POST /journal/reformat` (Claude Sonnet), images are uploaded to R2, then
   the entry is saved via `POST /journal` with `scope: "STRATEGY_BACKTEST"`.
4. The repository upserts the `(scope, date)` row and snapshots the save as a `TradingJournalRevision`
   (skipped if nothing changed), so every save during the day is traceable in **Lịch sử trong ngày**.

## Edge Cases
- **Old URL:** `/strategy-backtest` 307-redirects to `/trading-analysis` (`next.config.js` redirects), so
  existing bookmarks keep working.
- **Corpus isolation:** journal reads/writes are keyed by `(scope, date)`. `/journal` (scope `GENERAL`)
  and `/trading-analysis` (scope `STRATEGY_BACKTEST`) never see each other's entries, and both can have a
  row for the same calendar day.
- **Unknown scope:** the API normalizes any unknown/empty scope to `GENERAL` (allowlist in
  `journal.service.ts`).
- **Claude unreachable:** if reformat fails, the raw text is saved verbatim with a warning.
- **Revisions are scope-agnostic:** addressed by `entryId`, so no scope is needed to read them.

## Related Files (FE / BE / Worker)
- `apps/web/src/app/trading-analysis/page.tsx` — route (thin re-export).
- `apps/web/src/_pages/trading-analysis-page/trading-analysis-page.tsx` — server page; fetches the scoped
  journal + today's revisions and renders `<TradingJournal scope="STRATEGY_BACKTEST" …/>`.
- `apps/web/next.config.js` — 307 redirect `/strategy-backtest` → `/trading-analysis`.
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav item (now "Trading Analysis").
- `apps/web/src/widgets/trading-journal/trading-journal.tsx` — shared journal widget with optional
  `scope`/`title`/`subtitle`/`placeholder` props (defaults preserve `/journal`).
- `apps/web/src/shared/api/client.ts` — `fetchJournalEntries(scope?)`, `saveJournalEntry({ scope, … })`.
- `apps/api/src/modules/journal/*` — `scope` query/body + allowlist normalization.
- `packages/db/src/repositories/trading-journal.repository.ts`, `packages/db/prisma/schema.prisma`,
  `packages/db/prisma/migrations/20260917120000_journal_scope/` — the `(scope, date)` model + migration.
- Kept but unused by the page: `apps/web/src/widgets/strategy-backtest/` (board FE),
  `apps/api/src/modules/strategy-backtest/` (API), worker scan service, `strategy_backtest_setups` table.
