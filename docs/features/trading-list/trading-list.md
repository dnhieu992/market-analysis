## Description
`/trading-list` puts Bitget and MEXC on one page under the same tabs as `/bitget` and `/mexc`: Vị thế · Lịch sử · Setup,
with one AI chat that reads both accounts. The trader manages open positions / pending orders, reviews history, sets up
coins, opens MARKET / LIMIT entries on either exchange, and asks the AI to analyse or to propose open / limit / DCA / TP /
close / cancel cards on either exchange. `/bitget` and `/mexc` are unchanged and keep working on their own.

## Main Flow
1. The server page loads both exchanges' open positions and closed-trade history (each non-fatal). Tabs: Vị thế
   (default) · Lịch sử · Setup. Each tab has its own exchange filter (Tất cả / BG / MX), kept while switching tabs.
   - Vị thế: one positions table and one pending-orders table, each row tagged BG / MX, live prices from each
     exchange's own WS. Close / TP/SL / cancel / journal / chart go to the row's exchange. "Huỷ tất cả" cancels only
     the pending rows the filter shows; its confirm names the exchanges and counts. Tiles add up the filtered exchanges
     (balance only when every kept exchange reports equity). The "Hiện value" toggle has its own storage key.
   - Lịch sử: one closed-trade table, newest close first, coin filter + paging, review chart / saved charts / journal on
     the trade's exchange. With no coin picked the tiles fold the server summaries; otherwise they are recomputed.
   - Setup: the coin table below; a single-exchange filter hides the other exchange's lines in LONG / SHORT cells.
2. The table lists one row per coin: pins (BTC, ETH), the built-in watchlist, coins added by hand, then every coin
   traded on either exchange. Price / today change come from the Bitget WS (MEXC WS as fallback); 7d / 30d / H4 and
   QQE come from the Bitget endpoints (Binance candles, so they serve both exchanges).
3. Stars, the assessment ("Đánh giá") and hand-added coins are stored in the new `trading_list_*` tables — shared by
   both exchanges on this page, separate from the `/bitget` and `/mexc` tables. The migration seeds them once:
   stars from Bitget (> 0), MEXC fills coins Bitget never rated; notes from Bitget; hand-added coins from MEXC.
4. Each LONG / SHORT cell has a `BG` and an `MX` line with that exchange's leverage/margin config, "● Đang mở" state
   and Market / Limit buttons. The ⚙ dialog edits both exchanges' configs — the same rows `/bitget` and `/mexc` use.
   Every confirm prompt starts with the exchange name.
5. The AI chat (skill `trading-list-ai`) opens from the floating AI button as a slide-in panel, as on `/bitget`. Typing `@` opens a menu
   with `@bitget` / `@mexc`; quick buttons insert them too. The skill reuses the `bitget_*` / `mexc_*` read tools and
   both `propose_*_action` tools, plus `trading_list_setup` (shared stars/notes + both configs). An action request
   that names no exchange is answered with a question — the AI never guesses the exchange.
6. Cards still land in `bitget_ai_actions` / `mexc_ai_actions`; the chat shows them with an exchange tag and runs each
   through that exchange's existing execute / dismiss endpoint. After a card runs, the tabs remount on fresh positions and history.

## Edge Cases
- A coin that is not listed on one exchange still shows its line; the exchange rejects the order with its own error.
- Adding a coin is accepted when either Bitget or MEXC lists a USDT-M contract for it.
- MEXC does not attach a TP to a LIMIT order — the confirm dialog and the prompt say so.
- Bitget auto-entry is shown as the AUTO badge only; it is switched on `/bitget`.
- The strategy section of the prompt is sliced from the `/bitget` prompt, so edits there carry over.

## Related Files (FE / BE / Worker)
- `apps/web/src/app/trading-list/page.tsx`, `apps/web/src/_pages/trading-list-page/trading-list-page.tsx` — route + server data load
- `apps/web/src/widgets/trading-list/trading-list-view.tsx` — tabs, per-tab exchange filter, AI button
- `apps/web/src/widgets/trading-list/trading-list-positions.tsx` — Vị thế tab (positions + pending orders, both exchanges)
- `apps/web/src/widgets/trading-list/trading-list-history.tsx` — Lịch sử tab (closed trades, both exchanges)
- `apps/web/src/widgets/trading-list/exchange-filter.tsx` — Tất cả / BG / MX switch
- `apps/web/src/widgets/trading-list/trading-list-feed.tsx` — the combined coin table
- `apps/web/src/widgets/trading-list/exchange-config-dialog.tsx` — ⚙ config for both exchanges
- `apps/web/src/widgets/trading-list/add-coin-dialog.tsx` — hand-added coins
- `apps/web/src/widgets/trading-list/trading-list-ai-chat.tsx` — AI chat, @ mention, exchange-tagged cards + confirm
- `apps/web/src/widgets/trading-list/exchanges.ts`, `trading-list.module.css` — labels / tags / styles
- `apps/web/src/shared/api/client.ts`, `types.ts` — `/trading-list/*` client + types
- `apps/api/src/modules/trading-list/*` — shared stars / notes / watchlist API
- `apps/api/src/modules/chat/tools/trading-list-ai.tools.ts` — `trading_list_setup` tool + two-account context
- `apps/api/src/modules/chat/conversation.service.ts` — loads both exchanges' cards for the skill
- `packages/skills/src/trading-list-ai/*` — skill + system prompt
- `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20261031120000_trading_list/` — tables + seed
- `packages/db/src/repositories/trading-list.repository.ts` — repository
