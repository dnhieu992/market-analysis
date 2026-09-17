## Description
A daily analysis journal embedded on the `/strategy-backtest` page, below the setup board. It lets the
trader write, each day, the reasoning behind their setup process — how they read the chart, why they
did/didn't take a setup, how they manage and monitor open orders. It reuses the exact `/journal`
machinery (per-day markdown entry, Claude auto-format on save, intra-day revision history, images, tags)
but stores its entries in a **separate corpus** so the "setup analysis" training data stays distinct from
the general trading journal.

The purpose is a clean, labelled dataset: each day's analysis notes sit next to the concrete setups
created that day, so Claude can later learn to clone the trader's analysis + trade-monitoring behaviour.

## Main Flow
1. Trader opens `/strategy-backtest`. The server component fetches the setup board **and** the journal
   entries for scope `STRATEGY_BACKTEST` (plus today's intra-day revisions), then renders the board
   followed by the `TradingJournal` widget.
2. Trader writes the day's analysis in the markdown editor and clicks **Lưu / Cập nhật**.
3. The text is reformatted via `POST /journal/reformat` (Claude Sonnet), images are uploaded to R2, then
   the entry is saved via `POST /journal` with `scope: "STRATEGY_BACKTEST"`.
4. The repository upserts the `(scope, date)` row and snapshots the save as a `TradingJournalRevision`
   (skipped if nothing changed), so every save during the day is traceable in **Lịch sử trong ngày**.

## Edge Cases
- **Corpus isolation:** journal reads/writes are keyed by `(scope, date)`. `/journal` (scope `GENERAL`)
  and `/strategy-backtest` (scope `STRATEGY_BACKTEST`) never see each other's entries, and both can have
  a row for the same calendar day.
- **Unknown scope:** the API normalizes any unknown/empty scope to `GENERAL` (allowlist in
  `journal.service.ts`), so a bad query param can never create a stray corpus.
- **Claude unreachable:** if reformat fails, the raw text is saved verbatim with a warning (unchanged
  `/journal` behaviour).
- **Migration safety:** existing rows default to `scope = 'GENERAL'`; the old `date`-only unique index is
  replaced by a composite `(scope, date)` unique. Additive and non-destructive.
- **Revisions are scope-agnostic:** they are addressed by `entryId`, so no scope is needed to read them.

## Related Files (FE / BE / Worker)
- `apps/web/src/_pages/strategy-backtest-page/strategy-backtest-page.tsx` — server page; fetches the
  scoped journal + today's revisions and renders `<TradingJournal scope="STRATEGY_BACKTEST" …/>` below the board.
- `apps/web/src/widgets/trading-journal/trading-journal.tsx` — shared journal widget; now takes optional
  `scope`, `title`, `subtitle`, `placeholder` props (defaults preserve `/journal`).
- `apps/web/src/shared/api/client.ts` — `fetchJournalEntries(scope?)` and `saveJournalEntry({ scope, … })`.
- `apps/web/src/shared/api/types.ts` — `TradingJournalEntry.scope`.
- `apps/api/src/modules/journal/journal.controller.ts` — `scope` query on `GET /journal` and `GET /journal/:date`.
- `apps/api/src/modules/journal/journal.service.ts` — scope allowlist + normalization; threads scope through.
- `apps/api/src/modules/journal/dto/upsert-journal.dto.ts` — optional `scope` on the POST body.
- `packages/db/src/repositories/trading-journal.repository.ts` — `scope` on `findAll`/`findByDate`/`upsertByDate`.
- `packages/db/prisma/schema.prisma` — `TradingJournalEntry.scope` + `@@unique([scope, date])`.
- `packages/db/prisma/migrations/20260917120000_journal_scope/migration.sql` — the additive migration.
