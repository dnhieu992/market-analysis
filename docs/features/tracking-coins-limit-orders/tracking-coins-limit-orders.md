## Description
Auto-generated limit order suggestions for tracked coins. Orders are computed from Binance klines (swing from 4H, daytrade from 1H) and persisted to the database on every load or re-analyze. Users can annotate each order with personal notes. The suggestions live inside the **coin detail dialog** (opened by clicking a row), which is organised into 4 tabs: **Overview** (indicator analysis), **Tín hiệu hôm nay** (today's live orders), **Lịch sử tín hiệu** (saved order history), and **Journal**. There is no separate "Lệnh" or "Journal" button/dialog on the table anymore.

## Main Flow
1. User clicks a coin row → `CoinDetailModal` opens on the **Overview** tab (`CoinOverview`: D1/H4 indicator grid, swing structure, 30-day sparkline, TradingView link).
2. **Tín hiệu hôm nay** tab → `CoinLiveSignal` calls `GET /tracking-coins/coins/:symbol/order-suggestions`.
3. API fetches 4H/1H klines from Binance, computes swing + daytrade limit orders.
4. Orders are upserted into `tracking_coin_orders` for today's date (notes preserved on update); response includes `id` and `notes` alongside price levels.
5. `CoinLiveSignal` renders today's orders; user can type notes — saved on blur via `PATCH /tracking-coins/coins/orders/:id/notes`. The ↻ button re-fetches/recomputes.
6. **Lịch sử tín hiệu** tab → `CoinHistorySignal` fetches all saved orders via `GET /tracking-coins/coins/:symbol/orders`; inline notes editing also available.
7. **Journal** tab → `CoinJournalPanel` (see markdown-editor feature doc) renders the per-day journal entries.

## Edge Cases
- Notes are excluded from the `upsertOrder` update clause so re-analyze never overwrites existing notes
- Each tab fetches independently when first shown; switching tabs unmounts/remounts content, so revisiting a tab re-fetches fresh data
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
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — `CoinDetailModal` (4-tab dialog); `CoinOverview`; `CoinLiveSignal` (today); `CoinHistorySignal` (history); `OrderCard` with notes textarea; `HistoryNoteCell`; `OrderHistoryTable`
- `apps/web/src/widgets/tracking-coin-journal/tracking-coin-journal.tsx` — `CoinJournalPanel` embedded in the Journal tab
- `apps/web/src/app/globals.css` — `.ord-card__notes`, `.ord-hist__notes`; `.tc-detail-dialog` (760px desktop); `.tc-detail-tabs`/`.tc-detail-tab` tab bar; `.tc-tf-grid` aligned indicator grid; `.tc-overview`/`.tc-signal`; `.jrn-*` journal panel styles
