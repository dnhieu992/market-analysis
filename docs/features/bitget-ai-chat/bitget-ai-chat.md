## Description
AI chat on `/bitget` (added 2026-10-25). A floating 🤖 **AI** button (bottom right) opens a
right-side panel built from the shared chat UI (`shared/ui/chat/chat-parts.tsx`). It answers
questions about the **live** Bitget account ("đang có lệnh BTC long nào không", "lệnh nào chưa
có TP", "tuần này lãi lỗ thế nào") and proposes actions as cards. **Nothing reaches Bitget
until the user confirms a card.** Orders are real; take-profit only — no code path in this
feature ever sets a stop-loss (an SL the trader set by hand is kept when the TP changes).

## Conversation
- Hidden skill `bitget-ai` (`packages/skills/src/bitget-ai/`), conversations use
  `skillId='bitget-ai'`. One running thread: the panel opens the newest conversation,
  "Bắt đầu lại" starts a new one (older ones stay in the DB).
- Each message sends the current tab as `context` (`SendMessageDto.context`), shown to Claude
  under "Trang người dùng đang xem".
- History: the newest 30 messages go verbatim; older ones become a one-line-per-message digest
  in the system prompt (`digestOlder`, ≤ 6000 chars).
- Every reply also gets an account snapshot (capital, equity, margin in use, positions with
  ROE/TP) and the cards already proposed in the thread (`BitgetAiChatService.buildContext`).
- Up to 10 tool rounds per reply (`ChatRunOptions.maxToolIterations`).

## Tools (`apps/api/src/modules/chat/tools/bitget-ai.tools.ts`)
Read-only: `bitget_account`, `bitget_positions`, `bitget_pending_orders`, `bitget_history`,
`bitget_setup` (configs, stars, notes, auto-trade + latest run), `bitget_journal`,
`bitget_charts` (attaches the newest saved chart images so Claude can look at them —
`ChatToolRichResult`), `bitget_signals` (QQE H4/D1 + H4/7d/30d change), plus
`analyze_market_structure`, `get_klines`, `get_ticker_price`.

`propose_bitget_action` only stores a card in `bitget_ai_actions` (status `PROPOSED`). Types:

| Type | What it does on confirm |
|---|---|
| `OPEN` | MARKET or LIMIT entry (adds if the side is open), optional TP |
| `DCA` | One add to an open position (MARKET/LIMIT), optional new TP for the whole position. No ladders — DCA levels are given as text only |
| `SET_TP` | Set / move the position TP (keeps a hand-set SL) |
| `CLOSE` | Close `closePct` % at market, reduce-only (`POST /bitget/positions/close-partial`; 100 % = flash close) |
| `CANCEL` | Cancel a resting limit order by `orderId` |

Margin / leverage default to the coin's Setup config; an open position keeps its leverage.
A LIMIT on a flat side carries the TP as `presetStopSurplusPrice`; a LIMIT that will merge
into an open position does not (set the TP after it fills).

## Confirm flow
Card → **Xác nhận…** → dialog with editable margin / leverage / price / TP / close %, the
current position, new average entry, TP move % and est. profit, margin in use before → after
(% of capital) and the warning **"Lệnh thật trên Bitget · không có SL"**. No hard limits in
code. `POST /bitget/ai/actions/:id/execute` (`BitgetAiActionService`) runs it and stores
`executedParams`, `result`, `orderId` or `error` → status `EXECUTED` / `FAILED` (retry
allowed). **Bỏ qua** → `DISMISSED`. Executed cards write a `system` note
"🤖 Từ AI chat — …" on the position's journal. The page refetches positions/history and
remounts the tab after an action.

## Strategy
`packages/skills/src/bitget-ai/system.ts`. Scans and general questions are always SWING; scalping (M30/15m/5m via get_scalp_chart_data, small habitual TPs, only with the D1/H4 trend) only when the user asks about scalping one specific coin. v2 (2026-10-25) is swing-first because there is no SL: trend from 1W/1D, QQE D1 as the filter and H4 for timing, LIMIT at support, TP under the next D1/H4 resistance (≈ BTC +2–4 %, alts +5–10 %), DCA only at D1/W support with wider spacing (BTC −4 %, alts −10–12 %, ≤ 3 adds). v1 was inferred from the account itself (295 closed
trades 17/07–24/10/2026: 85 % win rate, +$0.33 avg win / −$0.08 avg loss, 84 % LONG, margin
$0.5–1.5 per entry at 10–50× cross, median hold ~9h), the Setup configs, stars, notes and the
journal. It is the trader's call — edit the file to change behaviour. Main rules: LONG bias
with QQE H4 / support confirmation, always a TP (per-coin habitual targets), DCA only at real
support with minimum spacing, warn above 50 % / stop opening above 70 % margin-in-use.

## Math
`packages/core/src/orders/bitget-position-math.ts` (+ spec): size from margin, average entry
after an add, favourable move %, PnL at a price, margin share of capital, partial-close size.

## Testing
Unit tests for the math only. The live-order paths are tested manually by the trader — never
execute cards from scripts.
