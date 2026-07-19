## Description

Per-trade journal for the `/bitget` open-positions table. Lets the trader keep a
manual, timestamped log of how they are watching a single live position — plans,
price levels, reasons to hold/exit, emotions — with optional chart images. Each
note is reformatted by Claude on save (shared `/journal/reformat` endpoint) and
captures a snapshot of the mark price / ROE at the moment it was written, so the
timeline reads as a record of the trade as it developed.

Notes are grouped per **trade session** (`tradeKey = symbol-holdSide-openedAt`),
so closing and re-opening the same symbol/side later starts a fresh timeline
instead of mixing two different trades' notes.

## Main Flow

1. On the `/bitget` **Vị thế đang mở** tab, each position row has a 📝 button.
2. Clicking it opens a right-side drawer (`BitgetJournalDrawer`, rendered via a
   portal to `document.body`) for that position's `tradeKey`.
3. The drawer loads existing notes (`GET /bitget/journal?tradeKey=`) and shows
   them oldest-first as a timeline, each with its write-time price/ROE snapshot.
4. The trader writes a note in the TipTap `MarkdownEditor`, optionally attaching
   images (uploaded to Cloudflare R2 via `POST /upload/images`).
5. On **Lưu ghi chú**: the raw markdown is reformatted by Claude
   (`POST /journal/reformat`), images are uploaded, then the note is persisted
   (`POST /bitget/journal`) with a snapshot of the current live position.
6. Notes can be edited (`PUT /bitget/journal/:id`) or deleted
   (`DELETE /bitget/journal/:id`).

## Edge Cases

- **Trade session identity** — `tradeKey` uses Bitget's `cTime` (position open
  time). If `openedAt` is missing it falls back to `na`, so notes still attach to
  the symbol/side while open.
- **Position closes while drawer is open** — the feed keeps the last-known
  position object (`lastJournalPos`) so the drawer stays readable; new notes can
  still be written against the same `tradeKey`.
- **Claude reformat fails** — the raw text is saved verbatim and a warning is
  shown; the note is never lost.
- **Live price freshness** — the drawer reads the latest position via a ref, so a
  snapshot captures the price at click time, not at drawer-open time.
- **Empty note** — saving is a no-op unless there is text or at least one image.

## Related Files (FE / BE / Worker)

- `apps/web/src/widgets/bitget-positions/bitget-journal-drawer.tsx` — the drawer UI (editor, upload, timeline, `tradeKeyOf`)
- `apps/web/src/widgets/bitget-positions/bitget-positions-feed.tsx` — 📝 button per row, drawer wiring, live-position tracking
- `apps/web/src/shared/api/client.ts` — `fetchBitgetJournal` / `addBitgetJournal` / `updateBitgetJournal` / `deleteBitgetJournal`
- `apps/web/src/shared/api/types.ts` — `BitgetJournalNote`, `BitgetJournalSnapshot`, `openedAt` on `BitgetPosition`
- `apps/web/src/app/globals.css` — `.bgj-*` drawer styles + `.bg-journal-btn`
- `apps/api/src/modules/bitget/bitget.controller.ts` — journal routes
- `apps/api/src/modules/bitget/bitget-journal.service.ts` — persist/map notes
- `apps/api/src/modules/bitget/dto/create-journal.dto.ts`, `dto/update-journal.dto.ts` — request validation
- `apps/api/src/modules/bitget/bitget.service.ts` / `bitget-trade.client.ts` — `openedAt` mapped from Bitget `cTime`
- `packages/db/prisma/schema.prisma` — `BitgetTradeJournal` model
- `packages/db/prisma/migrations/20260719120000_add_bitget_trade_journal/migration.sql` — table migration
- `packages/db/src/repositories/bitget-trade-journal.repository.ts` — repository factory
