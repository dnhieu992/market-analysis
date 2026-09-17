## Description
Inline editing of an Order's single `note` field from the **"Notes & Screenshots"** dialog on `/trades`
(the 📝 button on each row). Previously that dialog was read-only — it only displayed the note and
screenshots — so a note could only be set when creating a trade or via the Edit-trade form. Now the
trader can add/edit the note in the same place they open to read it.

This is separate from the per-order journal **timeline** (the 📓 drawer, see `trades-journal`): that is an
append-only log of many notes; this is the one `Order.note` text field shown on the row.

## Main Flow
1. Trader clicks the 📝 (Notes) button on a `/trades` row → `NotesDialog` opens.
2. The dialog shows a **Note** textarea (prefilled with `order.note`) plus the existing screenshots grid.
3. Trader edits the note and clicks **Lưu note** → `PATCH /orders/:id` via `updateOrder(order.id, { note })`.
4. On success the dialog shows **✓ Đã lưu** and calls `router.refresh()` so the server-rendered table
   reflects the new note without a full reload.

## Edge Cases
- **Dirty tracking:** the Save button is disabled until the text differs from the last saved value.
  Because the parent keeps the dialog open on the same (stale) `order` prop after `router.refresh()`,
  the baseline is held in local `savedNote` state, not the prop — otherwise "✓ Đã lưu" would never show.
- **Clearing a note:** saving an empty textarea sends `note: ""`, which clears the field (the DTO's
  `note` is `@IsOptional @IsString`, so an empty string is valid).
- **Save failure:** a failed `updateOrder` shows an inline error and leaves the text in the box to retry.
- **Sync safety:** the BingX sync (`bingx-history.service.ts`) never writes `note`, so a manually saved
  note is not clobbered on the next poll.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/trades-history/trades-table.tsx` — `NotesDialog` now has the note textarea +
  Save (`handleSaveNote`, `router.refresh()`).
- `apps/web/src/app/globals.css` — `.notes-edit-textarea` styling (matches `.trade-field textarea`).
- `apps/web/src/shared/api/client.ts` — `updateOrder` (already existed).
- `apps/api/src/modules/orders/orders.controller.ts` + `orders.service.ts` + `dto/update-order.dto.ts` —
  `PATCH /orders/:id` accepts `note` (unchanged; already whitelisted in `UpdateOrderDto`).
