## Description
The **Trading Journal** (`/journal`) is a daily notebook where the trader records analysis
and emotions in Markdown, attaches trade-model images, and adds freeform tags. There is **one
entry per calendar day** (upserted by `date`). The long-term intent is to build a corpus that
can later fine-tune an LLM "clone" of the trader's style and to review discipline over time —
so entries are kept as free text plus tags, with images stored in Cloudflare R2.

## Main Flow
1. User opens `/journal`. The server page (`journal-page.tsx`) loads all entries
   (`GET /journal`, newest day first) and renders the client widget `TradingJournal`.
2. The editor defaults to **today**. Picking a date loads that day's existing entry (content /
   tags / images) into the editor, or a blank one if none exists.
3. Content is edited with the shared **MarkdownEditor** (TipTap, lazy-loaded). Tags are added
   as chips (Enter / comma). Images are picked from disk and previewed locally as "mới" (not yet
   uploaded).
4. **Save** (`Cập nhật` / `Lưu nhật ký`): any newly-picked files are first uploaded to
   Cloudflare R2 via `POST /upload/images` (returns URLs), appended to the existing image URLs,
   then the whole entry is upserted via `POST /journal` (`{ date, content, images, tags }`).
   The API keys on `date`, so re-saving the same day updates in place.
5. The **past-entries list** below shows every day (date, image count, first-line preview,
   tags). Clicking an item opens that day in the editor. **Xoá ngày này** deletes via
   `DELETE /journal/:id`.

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
- **Auth** — all `/journal*` routes are behind the global `AuthGuard` (session cookie), like the
  rest of the API.

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — `TradingJournalEntry` model (date unique, content LongText, images/tags Json)
- `packages/db/prisma/migrations/20260714160000_add_trading_journal/migration.sql` — creates the table
- `packages/db/src/repositories/trading-journal.repository.ts` — `createTradingJournalRepository` (findAll/findByDate/upsertByDate/deleteById)
- `packages/db/src/index.ts` — exports the repository + `TradingJournalUpsert`
- `apps/api/src/modules/journal/journal.service.ts` — CRUD + DTO mapping (Json → string[], date-only handling)
- `apps/api/src/modules/journal/journal.controller.ts` — `GET /journal`, `GET /journal/:date`, `POST /journal`, `DELETE /journal/:id`
- `apps/api/src/modules/journal/dto/upsert-journal.dto.ts` — validated upsert body
- `apps/api/src/modules/journal/journal.module.ts` — module wiring
- `apps/api/src/app.module.ts` — registers `JournalModule`
- `apps/api/src/modules/upload/*` — existing `POST /upload/images` (Cloudflare R2) reused for images
- `apps/web/src/app/journal/page.tsx` — App Router route (thin re-export)
- `apps/web/src/_pages/journal-page/journal-page.tsx` — server page, loads entries
- `apps/web/src/widgets/trading-journal/trading-journal.tsx` — client UI (editor, tags, image upload, entry list)
- `apps/web/src/shared/api/client.ts` — `fetchJournalEntries`, `saveJournalEntry`, `deleteJournalEntry` (+ reused `uploadImages`)
- `apps/web/src/shared/api/types.ts` — `TradingJournalEntry`
- `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx` — reused TipTap editor
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — sidebar nav entry
- `apps/web/src/app/globals.css` — `.tj-*` styles
