## Description
The **Trading Journal** (`/journal`) is a daily notebook where the trader records analysis
and emotions in Markdown, attaches trade-model images, and adds freeform tags. There is **one
entry per calendar day** (upserted by `date`). The long-term intent is to build a corpus that
can later fine-tune an LLM "clone" of the trader's style and to review discipline over time —
so entries are kept as free text plus tags, with images stored in Cloudflare R2.

The trader writes at several points during a day, and overwriting the day's single row lost
that intra-day trail. Every save is therefore also stored as a **revision** — an immutable
snapshot (content + images + tags) of the day right after that save. The day itself stays one
row, so the "Nhật ký đã ghi" list is still **one item per day**; the revisions only feed the
**Lịch sử trong ngày** panel, which shows each save as a timestamped diff against the save
before it.

## Main Flow
1. User opens `/journal`. The server page (`journal-page.tsx`) loads all entries
   (`GET /journal`, newest day first) plus **today's revisions**
   (`GET /journal/:id/revisions`, so the history panel needs no client fetch on first paint)
   and renders the client widget `TradingJournal`.
2. The editor defaults to **today**. Picking a date loads that day's existing entry (content /
   tags / images) into the editor, or a blank one if none exists; the widget then fetches that
   day's revisions (skipped for the day the server preloaded).
3. Content is edited with the shared **MarkdownEditor** (TipTap, lazy-loaded). Tags are added
   as chips (Enter / comma). Images are picked from disk and previewed locally as "mới" (not yet
   uploaded).
4. **Save** (`Cập nhật` / `Lưu nhật ký`): any newly-picked files are first uploaded to
   Cloudflare R2 via `POST /upload/images` (returns URLs), appended to the existing image URLs,
   then the whole entry is upserted via `POST /journal` (`{ date, content, images, tags }`).
   The API keys on `date`, so re-saving the same day updates in place. In the same transaction
   the repository appends a `TradingJournalRevision` snapshot of what was just saved, then the
   widget reloads the history panel.
5. **Lịch sử trong ngày** lists that day's saves, newest first: time (HH:mm, `Asia/Ho_Chi_Minh`),
   a `+N / −M` line count, an `hiện tại` badge on the newest, and a preview = the first line the
   save added. Clicking a row expands the line diff against the previous save (plus that
   snapshot's tags and images). **↩ Khôi phục bản này** loads the snapshot back into the editor —
   it does **not** write to the DB, so restoring is itself just another save the user must confirm.
6. The **past-entries list** below shows every day (date, image count, first-line preview,
   tags) — still **one item per day**, unchanged by revisions. Clicking an item opens that day in
   the editor. **Xoá ngày này** deletes via `DELETE /journal/:id`.
7. **✨ Format lại** (next to the "Nội dung" label): sends the current editor content to
   `POST /journal/reformat`, which asks **Claude Haiku** (`claude-haiku-4-5-20251001`, hard-coded
   — not the app's `CLAUDE_MODEL`) to clean up the raw markdown (headings, bullet lists, bold key
   levels, fix typos / HTML entities, fix broken indentation) while preserving meaning and the
   Vietnamese voice. The returned markdown replaces the editor content; nothing is persisted until
   the user hits Save. This does **not** change the data on its own.

## Edge Cases
- **One entry per day** — the `TradingJournalEntry.date` column is `@unique`; `POST /journal`
  upserts, so there is never a duplicate day and no accidental second entry.
- **Images vs pending files** — already-saved images are R2 URLs (removable, persists on save);
  freshly-picked files live only in local state until Save uploads them. Removing a pending file
  before save simply drops it; removing a saved image drops its URL from the entry on next save.
- **Empty content** — allowed (a day may be tags/images only); the list preview shows
  "(chưa có nội dung)".
- **Upload failure** — surfaced as "Lưu nhật ký thất bại"; the entry is not saved so no partial
  state is persisted (upload happens before the upsert).
- **Save with no changes** — `upsertByDate` compares content/images/tags against the newest
  revision and skips the insert when they match, so hammering "Cập nhật" does not pad the
  timeline with identical snapshots.
- **Days written before revisions existed** — the migration backfills one revision per existing
  entry, timestamped at that day's `updatedAt`, so no day shows an empty history.
- **Deleting a day** — `trading_journal_revisions.entryId` is `ON DELETE CASCADE`, so the day's
  history goes with it (the confirm text says so).
- **UTC day vs local clock** — entries are keyed by UTC date while revision times render in
  `Asia/Ho_Chi_Minh`, so a save between 00:00–07:00 local lands on the previous UTC day. The
  row then shows `dd/MM HH:mm` instead of a bare hour that would look wrong. The timezone is
  pinned (not the browser's) so the SSR and client markup match.
- **Restore is not a write** — it only repopulates the editor; the user still has to Save, which
  creates a new revision rather than rewriting history.
- **Long entries** — the diff is O(n·m); over 1500 lines on either side it degrades to a
  whole-block replace instead of building the table.
- **Auth** — all `/journal*` routes are behind the global `AuthGuard` (session cookie), like the
  rest of the API.

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — `TradingJournalEntry` model (date unique, content LongText, images/tags Json) + `TradingJournalRevision` (entryId, snapshot columns, `@@index([entryId, createdAt])`, cascade delete)
- `packages/db/prisma/migrations/20260714160000_add_trading_journal/migration.sql` — creates the table
- `packages/db/prisma/migrations/20260717120000_add_trading_journal_revisions/migration.sql` — creates `trading_journal_revisions` + backfills one revision per existing day
- `packages/db/src/repositories/trading-journal.repository.ts` — `createTradingJournalRepository` (findAll/findByDate/findRevisionsByEntryId/upsertByDate — snapshots in a transaction, skips unchanged saves/deleteById)
- `packages/db/src/index.ts` — exports the repository + `TradingJournalUpsert`
- `apps/api/src/modules/journal/journal.service.ts` — CRUD + DTO mapping (Json → string[], date-only handling) + `listRevisions()` + `reformat()` (Claude Haiku call)
- `apps/api/src/modules/journal/journal.controller.ts` — `GET /journal`, `GET /journal/:date`, `GET /journal/:id/revisions`, `POST /journal`, `POST /journal/reformat`, `DELETE /journal/:id`
- `apps/api/src/modules/journal/dto/upsert-journal.dto.ts` — validated upsert body
- `apps/api/src/modules/journal/dto/reformat-journal.dto.ts` — validated reformat body (`{ content }`)
- `apps/api/src/modules/journal/journal.module.ts` — module wiring
- `apps/api/src/app.module.ts` — registers `JournalModule`
- `apps/api/src/modules/upload/*` — existing `POST /upload/images` (Cloudflare R2) reused for images
- `apps/web/src/app/journal/page.tsx` — App Router route (thin re-export)
- `apps/web/src/_pages/journal-page/journal-page.tsx` — server page, loads entries + today's revisions
- `apps/web/src/widgets/trading-journal/trading-journal.tsx` — client UI (editor, tags, image upload, history panel + `RevisionRow`, entry list)
- `apps/web/src/widgets/trading-journal/diff-lines.ts` — LCS line diff + `diffStat` (+N/−M, first added line) used by the history panel
- `apps/web/src/widgets/trading-journal/diff-lines.spec.ts` — unit tests for the diff
- `apps/web/src/shared/api/client.ts` — `fetchJournalEntries`, `saveJournalEntry`, `fetchJournalRevisions`, `deleteJournalEntry`, `reformatJournal` (+ reused `uploadImages`)
- `apps/web/src/shared/api/types.ts` — `TradingJournalEntry`, `TradingJournalRevision`
- `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx` — reused TipTap editor
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — sidebar nav entry
- `apps/web/src/app/globals.css` — `.tj-*` styles
