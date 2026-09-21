## Description
A free-text trading log for the PDH/PDL paper-trade board at `/trading-analysis`. A "📝 Ghi chú"
button next to "📖 Chi tiết chiến lược" opens a dialog with a preview list of saved notes on top and
a common composer below (a textarea + optional image upload). Each save appends one row to the log.

## Main Flow
1. On `/trading-analysis`, the trader clicks **📝 Ghi chú** in the board header.
2. The dialog opens and loads the log via `GET /strategy-paper-trades/notes` (newest first) into the
   preview list.
3. The trader types the note body and (optionally) attaches images with the shared `ImageUpload`.
4. On **Lưu ghi chú**:
   - If images were attached, they upload first via `POST /upload/images` → Cloudflare R2, returning URLs.
   - `POST /strategy-paper-trades/notes` saves `{ body, images }` and returns the created note.
   - The new note is prepended to the preview list; the composer (text + uploader) resets.
5. Each preview row shows the timestamp, body text (line breaks preserved), image thumbnails
   (click to zoom via the shared lightbox), and a 🗑️ delete action
   (`DELETE /strategy-paper-trades/notes/:id`, optimistic with restore on failure).

## Edge Cases
- **Empty body** is rejected client-side (Save disabled) and server-side (`BadRequestException`).
- **Image-only** is not allowed — body is required; images are optional.
- **Notes fetch fails**: the list shows a non-blocking "Không tải được ghi chú" message; the composer stays usable.
- **Delete fails**: the removed row is restored from the pre-delete snapshot.
- Body is stored/rendered as plain text (`whiteSpace: pre-wrap`) — no markdown/HTML injection.

## Related Files (FE / BE / Worker / DB)
- `apps/web/src/widgets/strategy-board/strategy-board.tsx` — "📝 Ghi chú" button + `NotesDialog` (preview list + composer)
- `apps/web/src/shared/ui/image-upload/image-upload.tsx` — reused image picker/upload component
- `apps/web/src/shared/api/client.ts` — `fetchStrategyPaperNotes` / `createStrategyPaperNote` / `deleteStrategyPaperNote`
- `apps/web/src/shared/api/types.ts` — `StrategyPaperNote` type
- `apps/api/src/modules/strategy-paper-trades/strategy-paper-trades.controller.ts` — `GET/POST/DELETE /strategy-paper-trades/notes`
- `apps/api/src/modules/strategy-paper-trades/strategy-paper-trades.service.ts` — `listNotes` / `createNote` / `deleteNote`
- `apps/api/src/modules/upload/upload.controller.ts` — existing `POST /upload/images` (R2) reused for attachments
- `packages/db/src/repositories/strategy-paper-note.repository.ts` — `list` / `create` / `remove`
- `packages/db/prisma/schema.prisma` — `StrategyPaperNote` model (`strategy_paper_notes`)
- `packages/db/prisma/migrations/20260921100000_add_strategy_paper_notes/migration.sql` — table migration
