## Description
Auto-generated limit order suggestions for tracked coins. Orders are computed from Binance klines (swing from 4H, daytrade from 1H) and persisted to the database on every dialog open or re-analyze. Users can annotate each order with personal notes.

## Main Flow
1. User opens the order dialog for a tracked coin → `GET /tracking-coins/coins/:symbol/order-suggestions`
2. API fetches 4H/1H klines from Binance, computes swing + daytrade limit orders
3. Orders are upserted into `tracking_coin_orders` for today's date (notes field is preserved on update)
4. Response includes `id` and `notes` alongside price levels
5. **Live tab** renders today's orders from the response; user can type notes — saved on blur via `PATCH /tracking-coins/coins/orders/:id/notes`
6. **History tab** fetches all saved orders via `GET /tracking-coins/coins/:symbol/orders`; inline notes editing also available
7. Re-analyze (↻ button) repeats from step 1, resets history cache so history tab re-fetches

## Edge Cases
- Notes are excluded from the `upsertOrder` update clause so re-analyze never overwrites existing notes
- History tab is lazily loaded and reset to `null` on re-analyze to ensure fresh data
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
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `OrderCard` with notes textarea; `HistoryNoteCell`; `OrderHistoryTable` with Ghi chú column
- `apps/web/src/app/globals.css` — `.ord-card__notes`, `.ord-hist__notes` styles
