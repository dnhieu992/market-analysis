## Description
Per-order log timeline for the manual `/trades` page. Each Order gets its own
append-only journal: automatic **system** logs are written when the trade is
opened and when it is closed, and the trader can add **manual** Markdown notes
(with chart images) at any point in between. Opened from a 📝 button on each
row into a portal drawer that reuses the Bitget journal drawer's look
(`bgj-*` styles).

This is a trimmed port of the Bitget per-trade journal: it keeps the auto
open/close lifecycle logs and manual notes, but **omits the ROE% milestone
logs** (no +50/+100/… ratchets) — manual orders have no worker reconcile loop.

## Main Flow
1. **Open** — creating a manual order (single or multiple form → `POST /orders`)
   inserts the Order, then `OrdersService.createOrder` appends a read-only
   system log `🟢 Đã mở lệnh <SIDE> <SYMBOL>` with entry price / size.
2. **Watch** — clicking 📝 on a row opens `OrderJournalDrawer`, which loads the
   timeline via `GET /orders/journal?orderId=`. The trader writes a note; on
   save it is Claude-reformatted (`/journal/reformat`), images upload to R2, and
   it is posted via `POST /orders/journal` with a `{ price, entryPrice, pnlUsd }`
   snapshot captured at write time.
3. **Close** — closing a trade (`PATCH /orders/:id/close`) flips the Order to
   `closed`, computes realized PnL, then appends a system log
   `🔴 Đã đóng lệnh <SIDE> <SYMBOL>` with close price and PnL.
4. Manual notes can be edited/deleted (`PUT`/`DELETE /orders/journal/:id`);
   system logs are read-only and reject edit/delete with a 400.

## Edge Cases
- **System logs are read-only** — API guards `PUT`/`DELETE` and throws
  `BadRequestException` if the target row's `kind === 'system'`; the drawer also
  hides Sửa/Xoá on system items.
- **Log write never breaks the trade** — `OrdersService.writeSystemLog` swallows
  errors (logs a `warn`), so a journal failure can't fail create/close.
- **Route ordering** — `/orders/journal*` routes are declared *before*
  `/orders/:id` in the controller so `journal` isn't captured as an `:id`.
- **Open vs closed snapshot** — for an open order the drawer's live price comes
  from the row's `livePrices`; for a closed order it uses `closePrice`/`pnl`.
- **Reformat failure** — if Claude is unreachable the raw note text is saved and
  a non-blocking warning is shown.

## Related Files (FE / BE / Worker)
- `packages/db/prisma/schema.prisma` — `OrderJournal` model (`order_journals`)
- `packages/db/prisma/migrations/20260719140000_add_order_journal/migration.sql` — table
- `packages/db/src/repositories/order-journal.repository.ts` — CRUD repo
- `apps/api/src/modules/orders/order-journal.service.ts` — list/create/update/remove + system-log guards
- `apps/api/src/modules/orders/orders.service.ts` — auto open/close system logs
- `apps/api/src/modules/orders/orders.controller.ts` — `/orders/journal*` routes
- `apps/api/src/modules/orders/dto/create-order-journal.dto.ts`, `update-order-journal.dto.ts` — DTOs
- `apps/web/src/widgets/trades-history/order-journal-drawer.tsx` — drawer UI
- `apps/web/src/widgets/trades-history/trades-table.tsx` — 📝 button (`tt-btn--journal`) + `IconJournal`
- `apps/web/src/widgets/trades-history/trades-history.tsx` — journal drawer state + `openJournal` target builder
- `apps/web/src/shared/api/client.ts` — `fetchOrderJournal`/`addOrderJournal`/`updateOrderJournal`/`deleteOrderJournal`
- `apps/web/src/shared/api/types.ts` — `OrderJournalNote`, `OrderJournalSnapshot`
