## Description
`/trading-list` puts the Setup coin list of Bitget and MEXC on one page, with one AI chat that reads both accounts.
The trader sets up coins, opens MARKET / LIMIT entries on either exchange, and asks the AI to analyse or to propose
open / limit / DCA / TP / close / cancel cards on either exchange. `/bitget` and `/mexc` are unchanged: open positions,
pending orders and history still live there.

## Main Flow
1. The server page loads both exchanges' open positions and closed-trade history (each non-fatal).
2. The table lists one row per coin: pins (BTC, ETH), the built-in watchlist, coins added by hand, then every coin
   traded on either exchange. Price / today change come from the Bitget WS (MEXC WS as fallback); 7d / 30d / H4 and
   QQE come from the Bitget endpoints (Binance candles, so they serve both exchanges).
3. Stars, the assessment ("Đánh giá") and hand-added coins are stored in the new `trading_list_*` tables — shared by
   both exchanges on this page, separate from the `/bitget` and `/mexc` tables. The migration seeds them once:
   stars from Bitget (> 0), MEXC fills coins Bitget never rated; notes from Bitget; hand-added coins from MEXC.
4. Each LONG / SHORT cell has a `BG` and an `MX` line with that exchange's leverage/margin config, "● Đang mở" state
   and Market / Limit buttons. The ⚙ dialog edits both exchanges' configs — the same rows `/bitget` and `/mexc` use.
   Every confirm prompt starts with the exchange name.
5. The AI chat (skill `trading-list-ai`) is docked on the right (a slide-in panel under 1280px). Typing `@` opens a menu
   with `@bitget` / `@mexc`; quick buttons insert them too. The skill reuses the `bitget_*` / `mexc_*` read tools and
   both `propose_*_action` tools, plus `trading_list_setup` (shared stars/notes + both configs). An action request
   that names no exchange is answered with a question — the AI never guesses the exchange.
6. Cards still land in `bitget_ai_actions` / `mexc_ai_actions`; the chat shows them with an exchange tag and runs each
   through that exchange's existing execute / dismiss endpoint. After a card runs, the table remounts on fresh positions.

## Edge Cases
- A coin that is not listed on one exchange still shows its line; the exchange rejects the order with its own error.
- Adding a coin is accepted when either Bitget or MEXC lists a USDT-M contract for it.
- MEXC does not attach a TP to a LIMIT order — the confirm dialog and the prompt say so.
- Bitget auto-entry is shown as the AUTO badge only; it is switched on `/bitget`.
- The strategy section of the prompt is sliced from the `/bitget` prompt, so edits there carry over.

## Related Files (FE / BE / Worker)
- `apps/web/src/app/trading-list/page.tsx`, `apps/web/src/_pages/trading-list-page/trading-list-page.tsx` — route + server data load
- `apps/web/src/widgets/trading-list/trading-list-view.tsx` — layout (table + docked chat)
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
