## Description
_A "🕘 History" button on the portfolio coin detail page (`/portfolio/<id>/<coin>`) that opens a dialog listing every investment cycle ("chu kì đã đầu tư") for that coin — the same dialog already shown from the portfolio holdings list. A cycle is one full buy→sell-to-zero round trip; the currently open position (not yet fully sold) shows as the last, still-open cycle._

## Main Flow
1. User opens a coin detail page and clicks **🕘 History** in the header actions (shown only when the coin has at least one transaction).
2. `CoinHistoryModal` builds cycles from the coin's transaction ledger via `buildCyclesForCoin` (sorts by time, accumulates buys/sells, closes a cycle when the running amount returns to ~0).
3. The dialog renders a table per cycle: start-buy time, sold-out time (or "Đang mở"), avg buy price, avg sell price, invested USDT, and P/L (fees netted). Closed cycles show P/L; the open cycle shows "—".

## Edge Cases
- **Still-holding coin:** the last cycle has `endAt = null`, renders "Đang mở" and no P/L.
- **No transactions:** the button is hidden; if opened with an empty ledger the dialog shows "Chưa có giao dịch nào cho <coin>".
- **Deleted transactions:** filtered out (`tx.deletedAt`) before cycle building.
- **Transfers:** stored as buy/sell legs, so they participate in the running amount like any trade (matches the list view's existing behavior).

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/coin-history/coin-history-modal.tsx` — shared `CoinHistoryModal` + `buildCyclesForCoin`/`Cycle` (extracted so both views render identically)
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — adds the History button + modal on the coin detail page
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` — now imports the shared modal instead of its local copy
