## Description
A chatbot on `/trades` (floating **🐻 Short AI** button) that analyses and enters **SHORT-only** trades on the **OKX** USDT-M perpetual (SWAP) account. It is the same kind of flow as the `/trading-list` AI chat (Claude proposes action cards, the user confirms, then the order goes to the exchange), but it has its own skill (`okx-short-ai`):
- Short only, OKX only (Bitget / MEXC / BingX are not touched).
- Every conversation is saved; **Lịch sử** lists old ones to review or delete.
- Notes: the chat can write a note on any OKX order of the `/trades` table (it lands in that order's journal drawer).
- The **analysis skill** is editable at runtime, with no deploy: from the chat ("cập nhật skill …" → `update_short_skill`) or from the **Skill** dialog. Every save is a new version; old versions can be viewed and restored.

The prompt has two parts: the fixed operating rules in code (`OKX_SHORT_SYSTEM_PROMPT`: short-only, cards, notes, how to edit the skill) and the editable analysis skill (newest row of `chat_skill_versions`, or `OKX_SHORT_DEFAULT_ANALYSIS_SKILL` while that table is empty).

## Main Flow
1. User opens `/trades` → clicks **Short AI** → the newest `okx-short-ai` conversation opens (or an empty one).
2. User sends a message → `POST /chat/conversations/:id/messages` → `ConversationService` builds the system prompt: fixed rules + `OkxShortAiChatService.buildContext()` (live analysis skill, OKX account snapshot, recent cards of this thread).
3. Claude runs tools: `okx_account`, `okx_positions`, `okx_pending_orders`, `okx_trades`, `okx_order_notes`, market data (`analyze_market_structure`, `get_klines`, `get_ticker_price`, `get_24h_ticker`, `get_scalp_chart_data`, `scan_junk_shorts`).
4. To trade it calls `propose_okx_short` (OPEN / DCA / SET_TP / CLOSE / CANCEL, always short) → a row in `okx_ai_actions` (status PROPOSED), shown as a card under the reply.
5. User clicks **Xác nhận trên OKX…** → confirm dialog (edit margin / leverage / limit price / TP / close %) → `POST /okx/ai/actions/:id/execute` → `OkxAiActionService` → `OkxService` places the order (cross margin; `set-leverage`, `trade/order` with attached TP, `order-algo` / `amend-algos` / `cancel-algos` for TP, `close-position` or a reduce order for CLOSE, `cancel-order`). Status → EXECUTED or FAILED (with the OKX error text).
6. An executed card writes a journal note on the open OKX short of `/trades` when the worker has already synced it.
7. Notes: "ghi note cho lệnh short ETH: …" → `add_order_note` → `order_journals` row on that order.
8. Skill edit: "thêm vào skill: …" → `get_short_skill` → `update_short_skill(content, note)` → new `chat_skill_versions` row (author LLM). Applies from the next message. The Skill dialog does the same with author USER, and **Khôi phục** writes an old version back as a new one.

## Edge Cases
- **API key without Trade permission**: `OkxService.getConfig()` reads `perm` from `/account/config`. When it lacks `trade`, every write is refused before reaching OKX with a clear message, the confirm dialog shows a red warning, and the chat context tells Claude. Fix: enable Trade on the key, or set `OKX_TRADE_API_KEY` / `OKX_TRADE_API_SECRET` / `OKX_TRADE_API_PASSPHRASE` (a separate trade key; the read-only `OKX_API_*` key keeps serving the worker sync) and restart `market-api` with `--update-env`.
- **Position mode**: works in both long/short mode (`posSide=short`) and net mode (sell to open, reduce-only buy to close, `reduceOnly` TP algo).
- **Sizing**: OKX sizes in contracts. Margin × leverage / (price × ctVal), floored to `lotSz`; below `minSz` → refused with the minimum margin needed.
- **Long requests**: `propose_okx_short` refuses any side other than short; `OkxAiActionService.execute` also refuses a non-short card.
- **TP on an existing position**: a MARKET add moves the position TP; a LIMIT add does not (TP is moved with a SET_TP card after the fill). A TP algo that also carries a hand-set SL is amended, not cancelled, so the SL stays.
- **Coin without an OKX SWAP** → refused at proposal time.
- **Fresh order not yet in /trades** (sync runs every 5 min): `add_order_note` says so, and the executed-card journal note is skipped.
- **Same skill content saved twice** → refused ("không có gì thay đổi").
- Long threads: the newest 30 messages go verbatim, older ones as a digest (same as the other exchange chats).

## Related Files (FE / BE / Worker)
- `packages/skills/src/okx-short-ai/system.ts` — fixed operating rules + default analysis skill
- `packages/skills/src/okx-short-ai/index.ts` — skill definition (hidden) + tool list
- `packages/db/prisma/schema.prisma` — `OkxAiAction` (`okx_ai_actions`), `ChatSkillVersion` (`chat_skill_versions`)
- `packages/db/prisma/migrations/20261106120000_okx_short_ai_chat/migration.sql` — creates both tables
- `packages/db/src/repositories/okx-ai-action.repository.ts`, `chat-skill-version.repository.ts` — repositories
- `apps/api/src/modules/okx/okx.service.ts` — OKX V5 trading client (read account, place / TP / close / cancel)
- `apps/api/src/modules/okx/okx-ai-action.service.ts` — runs confirmed cards, journal note on the /trades order
- `apps/api/src/modules/okx/okx-short-skill.service.ts` — versioned editable analysis skill
- `apps/api/src/modules/okx/okx.controller.ts` — `GET /okx/account`, `/okx/ai/actions*`, `/okx/ai/skill*`
- `apps/api/src/modules/chat/tools/okx-short-ai.tools.ts` — chat tools + reply context
- `apps/api/src/modules/chat/conversation.service.ts` — routes skill `okx-short-ai`, attaches `okxActions` to messages
- `apps/api/test/okx-sizing.spec.ts` — instrument id + contract sizing tests
- `apps/web/src/widgets/trades-history/okx-short-ai-chat.tsx` (+ `.module.css`) — FAB, panel, history, cards, confirm dialog, Skill dialog
- `apps/web/src/widgets/trades-history/trades-history.tsx` — mounts the chat on /trades
- `apps/web/src/shared/api/client.ts`, `types.ts` — OKX chat endpoints and types
- `apps/worker/src/modules/okx-history/okx-history.service.ts` — (unchanged) the 5-min read-only sync that puts OKX positions into /trades
