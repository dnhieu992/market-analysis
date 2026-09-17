## Description
Editing an Order's `note` and `images` from the **"Notes & Screenshots"** dialog on `/trades`
(the 📝 button on each row). Previously that dialog was read-only — it only displayed the note and
screenshots — so a note could only be set when creating a trade or via the Edit-trade form, and images
could only be deleted. Now the trader can add/edit the note **and upload screenshots** in the same place
they open to read them.

The dialog reuses the same building blocks as the order-journal drawer / trading journal:
- `MarkdownEditor` (lazy-loaded TipTap rich editor) for the note — the same editor the
  "Nhật ký lệnh" drawer uses, replacing the old plain `<textarea>`.
- `ImageUpload` (the shared existing-URLs + new-files uploader used by the Edit-trade form) for screenshots.

This is separate from the per-order journal **timeline** (the 📓 drawer, see `trades-journal`): that is an
append-only log of many notes; this is the one `Order.note` text field + `Order.images` shown on the row.

## Main Flow
1. Trader clicks the 📝 (Notes) button on a `/trades` row → `NotesDialog` opens.
2. The dialog shows the **Note** rich editor (prefilled with `order.note`) and an **ImageUpload** control
   prefilled with the order's existing screenshots.
3. Trader edits the note and/or adds/removes images, then clicks **Lưu**. On save, any newly picked files
   upload to R2 (`uploadImages(files, symbol, side)`), then `PATCH /orders/:id` via
   `updateOrder(order.id, { note, images })` persists note + the combined image list in one call.
4. On success the dialog shows **✓ Đã lưu**, remounts `ImageUpload` (so uploaded files become "existing"),
   and calls `router.refresh()` so the server-rendered table reflects the change without a full reload.

## Edge Cases
- **Dirty tracking:** the Save button is disabled until the note text OR the image list differs from the
  last saved values. Because the parent keeps the dialog open on the same (stale) `order` prop after
  `router.refresh()`, the baselines are held in local `savedNote`/`savedImages` state, not the prop.
- **Uploader remount:** after a successful save `ImageUpload` is remounted via an incrementing `key` and
  re-seeded with `savedImages`, so the just-uploaded files show as existing rather than still-pending.
- **Clearing a note:** saving an empty editor sends `note: ""`, which clears the field (the DTO's `note`
  is `@IsOptional @IsString`, so an empty string is valid).
- **Save failure:** a failed upload/update shows an inline error and keeps the dialog state to retry.
- **Sync safety:** the BingX sync (`bingx-history.service.ts`) never writes `note`/`images`, so manually
  saved notes and screenshots are not clobbered on the next poll.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/trades-history/trades-table.tsx` — `NotesDialog` now uses `MarkdownEditor` +
  `ImageUpload` + a single `handleSave` (`uploadImages` → `updateOrder` → `router.refresh()`).
- `apps/web/src/widgets/trades-history/trades-history.tsx` — call site (dropped the old `onImageDeleted`).
- `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx`,
  `apps/web/src/shared/ui/image-upload/image-upload.tsx` — reused components.
- `apps/web/src/shared/api/client.ts` — `updateOrder`, `uploadImages` (already existed).
- `apps/api/src/modules/orders/orders.controller.ts` + `orders.service.ts` + `dto/update-order.dto.ts` —
  `PATCH /orders/:id` accepts `note` + `images` (unchanged; already whitelisted in `UpdateOrderDto`).
