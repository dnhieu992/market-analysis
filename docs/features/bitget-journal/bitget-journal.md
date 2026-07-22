## Description

Trade lifecycle + per-trade journal for `/bitget`. Every Bitget USDT-futures trade
is mirrored into a single `bitget_trades` row that the worker moves through its
lifecycle (`status: open → closed`). Each trade carries a timeline of log items
(`bitget_trade_journals`): **manual** notes the trader writes (Claude-formatted,
with chart images) plus **system** items the worker writes automatically when a
trade opens and closes. Items are grouped per trade session by `tradeKey`
(`symbol-holdSide-openedAt(ISO)`), so re-opening the same symbol/side later starts
a fresh timeline.

## Main Flow

1. **Worker reconcile (every 15m + on boot)** — `BitgetHistoryService.sync()`:
   - Reads live open positions (`all-position`). A newly-seen one is inserted as
     `status=open` and gets a system "🟢 Đã mở lệnh" log with entry price, size, and
     — best-effort — a "So với giá mở cửa hôm nay (00:00 UTC): ±X.XX%" line, the
     entry price compared against Bitget's public ticker `openUtc` (the day's 00:00
     UTC open, same reference the Setup tab's "Hôm nay" column uses). The line is
     omitted if the ticker lookup fails; it never blocks the trade from being recorded.
   - Reads closed history (`history-position`). The matching open row is flipped to
     `status=closed` (realized PnL filled) and gets a system "🔴 Đã đóng lệnh" log.
     A trade opened+closed within one interval is inserted closed directly, with
     both an opened and a closed log.
2. **Open positions tab** — live from Bitget every 15s; each row has a 📝 button
   opening the journal drawer (`status: open`, live position attached).
3. **History tab** — reads `bitget_trades` where `status=closed`; each row has a 📝
   button opening the same drawer (`status: closed`).
4. **Drawer** — loads the trade's log timeline (`GET /bitget/journal?tradeKey=`),
   shows system + manual items chronologically. The trader writes a manual note
   (TipTap editor + image upload to R2); on save it is Claude-reformatted
   (`POST /journal/reformat`), images uploaded (`POST /upload/images`), then
   persisted (`POST /bitget/journal`) with a price/PnL snapshot. Manual notes can
   be edited/deleted; system items are read-only.

## Edge Cases

- **No positionId on open positions** — Bitget's open-position endpoint returns no
  id, so `tradeKey` (from `cTime`) is the stable lifecycle key; `positionId` is
  filled only on close.
- **Matching open↔closed** — primary match is by `tradeKey` (same `cTime`); a
  fallback matches an open row for the same symbol+side that is **not currently
  live**, so a live position is never closed by mistake. Only one open position per
  symbol+side exists on Bitget at a time.
- **Idempotent close** — once a trade has a `positionId`, re-syncing skips it, so
  the "closed" log is written exactly once.
- **Fast trades** (opened+closed between polls) still get both an opened and a
  closed log.
- **Day-open ticker lookup fails** — `fetchDayOpenPrice()` is best-effort; on
  failure the opened log is still written, just without the "So với giá mở cửa
  hôm nay" line (and `snapshot.dayOpenPrice`/`dayOpenChangePct` are omitted).
- **System items are read-only** — the API rejects edit/delete of `kind=system`.
- **Claude reformat fails** — the raw manual note is saved verbatim with a warning.
- **Legacy closed trades** (migrated from the old table) get a `legacy-<positionId>`
  tradeKey; they have no journal, and their 📝 simply shows an empty timeline.

## Related Files (FE / BE / Worker)

- `apps/web/src/widgets/bitget-positions/bitget-journal-drawer.tsx` — drawer (accepts an open/closed `JournalTarget`), `tradeKeyOf`
- `apps/web/src/widgets/bitget-positions/bitget-positions-feed.tsx` — 📝 on open positions
- `apps/web/src/widgets/bitget-history/bitget-history-feed.tsx` — 📝 on closed trades
- `apps/web/src/shared/api/client.ts` — `fetchBitgetJournal` / `addBitgetJournal` / `updateBitgetJournal` / `deleteBitgetJournal`
- `apps/web/src/shared/api/types.ts` — `BitgetJournalNote.kind`, `BitgetClosedTrade.tradeKey/status`, `BitgetPosition.openedAt`
- `apps/web/src/app/globals.css` — `.bgj-*` drawer styles (+ `.bgj-note--system`), `.bg-journal-btn`
- `apps/api/src/modules/bitget/bitget.service.ts` — closed history from `bitget_trades`; `openedAt` from `cTime`
- `apps/api/src/modules/bitget/bitget-journal.service.ts` — journal CRUD; blocks edit/delete of system items
- `apps/api/src/modules/bitget/bitget.controller.ts` / `dto/*` — journal routes + validation
- `apps/worker/src/modules/bitget-history/bitget-history.service.ts` — lifecycle reconciliation + auto open/close logs; `fetchDayOpenPrice()` (public ticker `openUtc`) feeds the opened log's day-open % line
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — 15-minute cron
- `packages/db/prisma/schema.prisma` — `BitgetTrade`, `BitgetTradeJournal` (+ `kind`)
- `packages/db/prisma/migrations/20260719140000_bitget_trades_lifecycle/migration.sql` — new table + data copy + drop old + `kind` column
- `packages/db/src/repositories/bitget-trade.repository.ts`, `bitget-trade-journal.repository.ts` — repositories
