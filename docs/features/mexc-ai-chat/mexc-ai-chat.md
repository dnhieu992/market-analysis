## Description
AI chat on `/mexc` (added 2026-10-28) — a clone of the `/bitget` AI chat
([`bitget-ai-chat.md`](../bitget-ai-chat/bitget-ai-chat.md)) bound to the live MEXC account. A floating
🤖 **AI** button (bottom right) opens a right-side panel built from the shared chat UI. It answers
questions about the account ("đang có lệnh BTC long nào không", "lệnh nào chưa có TP", "lãi tuần này")
and proposes actions as cards. **Nothing reaches MEXC until the user confirms a card.** Orders are
real; take-profit only — no code path in this feature ever sets a stop-loss (an SL the trader set by
hand is kept when the TP changes).

## Main Flow
1. Trader opens `/mexc` → 🤖 **AI**. The panel opens the newest `mexc-ai` conversation (one running
   thread; **Bắt đầu lại** starts a new one, older ones stay in the DB).
2. Each message is sent with the current tab as `context`. `ConversationService` builds the system
   prompt from the hidden skill `mexc-ai` (`packages/skills/src/mexc-ai/`) + the current time +
   `MexcAiChatService.buildContext()` (account snapshot: capital, equity, margin in use, positions with
   ROE/TP; and the cards already proposed in the thread) + a digest of messages older than the newest
   30. Up to 10 tool rounds per reply — the same long-thread handling as `/bitget`
   (`EXCHANGE_AI_RECENT_MESSAGES`, `EXCHANGE_AI_DIGEST_CHARS`).
3. Claude reads the account through read-only tools and, when asked, calls `propose_mexc_action`, which
   only stores a `PROPOSED` row in `mexc_ai_actions`. The row is attached to the reply message and
   rendered as a card under it.
4. Card → **Xác nhận…** → dialog with editable margin / leverage / price / TP / close %, the current
   position, new average entry, TP move % and est. profit, margin in use before → after (% of capital)
   and **"Lệnh thật trên MEXC · không có SL"**. Confirm → `POST /mexc/ai/actions/:id/execute`
   (`MexcAiActionService`) runs it and stores `executedParams`, `result`, `orderId` or `error` → status
   `EXECUTED` / `FAILED` (retry allowed). **Bỏ qua** → `DISMISSED`.
5. Executed cards write a `system` note "🤖 Từ AI chat — …" on the position's journal; the page
   refetches positions/history and remounts the tab.

### Tools (`apps/api/src/modules/chat/tools/mexc-ai.tools.ts`)
Read-only: `mexc_account`, `mexc_positions`, `mexc_pending_orders`, `mexc_history` (newest 500 closed
trades from `mexc_trades`), `mexc_setup` (configs, stars, watchlist), `mexc_journal`, `mexc_charts`
(attaches the newest saved chart images), `mexc_signals` (QQE H4/D1 + 7d/30d/90d change), plus
`analyze_market_structure`, `get_klines`, `get_ticker_price`, `get_scalp_chart_data`.

| Card | What it does on confirm |
|---|---|
| `OPEN` | MARKET or LIMIT entry (adds if the side is open), optional TP |
| `DCA` | One add to an open position (MARKET/LIMIT), optional new TP for the whole position |
| `SET_TP` | Set / move the position TP (keeps a hand-set SL) |
| `CLOSE` | Close `closePct` % at market (`POST /mexc/positions/close-partial`; 100 % = full close) |
| `CANCEL` | Cancel a resting limit order by `orderId` |

### Differences from `/bitget`
- **No preset TP on LIMIT orders.** MEXC's order endpoint is used without a TP; a LIMIT card's TP is
  recorded in the journal as "đặt sau khi lệnh khớp" and must be set (SET_TP) once it fills. The
  confirm dialog says so under the TP field.
- **No per-coin notes and no auto-trade** on `/mexc`, so `mexc_setup` returns configs + stars +
  watchlist only, and the prompt drops the Bitget star list (stars are read live).
- **Partial close is in contracts:** `closePartial` floors `holdVol × pct` to the contract's `volScale`
  and rejects a slice under `minVol`; the close is a closing-side market order on that `positionId`.
- **Price change** is 7d / 30d / 90d (the MEXC Setup tab has no H4 change column).

## Edge Cases
- **MEXC API key expired / not configured:** `mexc_account` / `mexc_positions` say so; `buildContext`
  writes "Không đọc được" into the prompt instead of failing the reply.
- **DCA with no open position** → the tool refuses (use OPEN); executing such a card throws 409.
- **TP on the wrong side** of entry / mark → refused when proposing, and again by `setTpsl`.
- **Margin below the contract minimum** → `openPosition` / `placeLimitOrder` throw "Ký quỹ quá nhỏ";
  the card becomes `FAILED` with that message and can be retried with a bigger margin.
- **Partial close under `minVol`** → 400 "dưới mức tối thiểu … Tăng tỉ lệ đóng."
- **TP fails after a MARKET entry filled** → the card is still `EXECUTED` (the position exists); the
  journal and `result.takeProfitNote` carry "LỖI đặt TP …".
- **Stopped / errored reply** → cards created before the stop are still attached to the partial reply.

## Related Files (FE / BE / Worker)
- `packages/skills/src/mexc-ai/index.ts` — hidden skill `mexc-ai`, its tool allow-list.
- `packages/skills/src/mexc-ai/system.ts` — strategy prompt (swing-first v2 cloned from `bitget-ai`).
- `packages/skills/src/SkillRegistry.ts`, `packages/skills/src/index.ts` — register the skill.
- `apps/api/src/modules/chat/tools/mexc-ai.tools.ts` — `MexcAiChatService`: read-only tools, `propose_mexc_action`, `buildContext()`.
- `apps/api/src/modules/chat/tools/trading-chat-tool-registry.ts` — registers the MEXC tools from DI.
- `apps/api/src/modules/chat/chat.module.ts` — imports `MexcModule`, provides `MexcAiChatService`.
- `apps/api/src/modules/chat/conversation.service.ts` — shared exchange-AI thread handling (recent 30 + digest, context, 10 tool rounds), attaches `mexcActions` to messages.
- `apps/api/src/modules/mexc/mexc-ai-action.service.ts` — runs a confirmed card on the live account and journals it.
- `apps/api/src/modules/mexc/mexc.controller.ts` — `POST /mexc/positions/close-partial`, `GET /mexc/ai/actions`, `POST /mexc/ai/actions/:id/execute`, `POST /mexc/ai/actions/:id/dismiss`.
- `apps/api/src/modules/mexc/dto/close-partial.dto.ts`, `dto/execute-ai-action.dto.ts` — request validation.
- `apps/api/src/modules/mexc/mexc.service.ts` — `closePartial()`, `getTickerPrice()`, `getRawPosition()`, `getLiveTpsl()`, `logToJournal()`.
- `apps/api/src/modules/mexc/mexc-trade.client.ts` — `closePosition()` takes an optional contract `vol` for partial closes.
- `apps/api/src/modules/mexc/mexc.module.ts` — provides `MexcAiActionService`, exports the services the chat tools use.
- `packages/db/prisma/schema.prisma` — `MexcAiAction` (`mexc_ai_actions`).
- `packages/db/prisma/migrations/20261028090000_mexc_ai_actions/migration.sql` — table DDL.
- `packages/db/src/repositories/mexc-ai-action.repository.ts` — create / find / list / attachToMessage / update.
- `apps/web/src/widgets/mexc/mexc-ai-chat.tsx` + `mexc-ai-chat.module.css` — floating button, panel, action cards, confirm dialog.
- `apps/web/src/widgets/mexc/mexc-tabs.tsx` — mounts the chat, refetches + remounts the feeds after an action.
- `apps/web/src/shared/api/client.ts` — `executeMexcAiAction()`, `dismissMexcAiAction()`.
- `apps/web/src/shared/api/types.ts` — `MexcAiAction`, `MexcAiActionEdits`, `ChatMessage.mexcActions`.
- `apps/web/src/shared/ui/chat/chat-parts.tsx` — progress labels for the `mexc_*` tools.
- `packages/core/src/orders/bitget-position-math.ts` — shared position math (`partialCloseSize`, `averageEntry`, …).

## Testing
Typecheck only plus the existing position-math unit tests. The live-order paths are tested manually by
the trader — never execute cards from scripts.
