## Description
> **UI removed (2026-06-27).** The user no longer uses limit-order signals on `/tracking-coins`,
> so the **Tín hiệu hôm nay** and **Lịch sử tín hiệu** tabs (and their components `CoinLiveSignal`,
> `CoinHistorySignal`, `OrderCard`, `NoTradeCard`, `OrderHistoryTable`, `OutcomeBadge`,
> `HistoryNoteCell`) were deleted from the coin detail dialog. The dialog now has only **Overview**
> and **Journal** tabs. The backend (order computation, persistence, notes endpoints) is left intact
> but is no longer surfaced anywhere in the UI — treat it as dormant. The rest of this doc is kept
> for the backend reference only.

Auto-generated limit order suggestions for tracked coins. Orders are computed from Binance klines (swing from 4H, daytrade from 1H) and persisted to the database. Each order can carry personal notes.

## Main Flow (backend only — no UI entry point remains)
1. The order-suggestion endpoint fetches 4H/1H klines from Binance and computes swing + daytrade limit orders.
2. Orders are upserted into `tracking_coin_orders` for today's date (notes preserved on update); response includes `id` and `notes` alongside price levels.
3. Notes can still be patched via `PATCH /tracking-coins/coins/orders/:id/notes`, and history read via `GET /tracking-coins/coins/:symbol/orders`, but no page calls these anymore.

## Edge Cases
- Notes are excluded from the `upsertOrder` update clause so re-analyze never overwrites existing notes
- Volume fields (`positionSize`, `positionValue`) are recalculated from risk setup on every upsert; existing notes are not affected

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — `suggestOrders` upserts to DB and returns id+notes; `updateOrderNotes`; `listOrders` includes notes
- `apps/api/src/modules/tracking-coins/tracking-coins.controller.ts` — `PATCH /coins/orders/:orderId/notes`
- `apps/api/src/modules/tracking-coins/dto/update-order-notes.dto.ts` — DTO for notes patch
- `packages/db/prisma/schema.prisma` — `notes String? @db.Text` on `TrackingCoinOrder`
- `packages/db/prisma/migrations/20260613000003_add_order_notes/migration.sql` — migration
- `packages/db/src/repositories/tracking-coins.repository.ts` — `updateOrderNotes`, `findOrdersByDate`; `upsertOrder` preserves notes
- `apps/web/src/shared/api/types.ts` — `OrderSuggestion` and `TrackingCoinOrder` types include `notes`
- `apps/web/src/shared/api/client.ts` — `updateOrderNotes()` method
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `CoinDetailModal` now only **Overview** + **Journal** tabs; the signal/history tab components were removed
- `apps/web/src/widgets/tracking-coin-journal/tracking-coin-journal.tsx` — `CoinJournalPanel` embedded in the Journal tab
- `apps/web/src/app/globals.css` — `.ord-card__notes`, `.ord-hist__notes`; `.tc-detail-dialog` (760px desktop); `.tc-detail-tabs`/`.tc-detail-tab` tab bar; `.tc-tf-grid` aligned indicator grid; `.tc-overview`/`.tc-signal`; `.jrn-*` journal panel styles
