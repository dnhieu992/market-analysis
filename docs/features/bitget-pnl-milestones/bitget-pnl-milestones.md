## Description

Records ROE% milestones for open Bitget positions onto each trade's journal, with
the time each milestone was reached. Milestones are two independent ratchets, each
logged **once per profit/loss excursion**:

- **Up:** +50%, +70%, +100%, +150%, +200%
- **Down:** −50%, −80%, −100%, −200%, −300%, −400%, −500%

"Only record forward within the same excursion": after +50% is logged the next
up-log can only be +70%; if ROE hits +50%, falls back to +40% (or +10%, anything
still positive), then returns to +50%, nothing is written. The downside ratchet
works the same way and is independent of the upside one.

**Reversal resets the opposite ratchet.** ROE crossing 0 (profit→loss or
loss→profit) clears the ratchet for the direction being left, so its steps can be
logged fresh next time. Example: ROE reaches +50% (logged), dips into the negative
(a real loss), then climbs back to +50% → +50% is logged **again**. A same-side dip
that never crosses 0 is not a reversal and does not re-log. ROE here is
`unrealizedPnl ÷ margin × 100` — the same number the /bitget positions table shows.

## Main Flow

1. A cron in `SchedulerService` (`runBitgetMilestoneSync`, every minute) calls
   `BitgetHistoryService.syncMilestones()`.
2. `syncMilestones()` fetches live open positions (`all-position`) and, for each,
   computes ROE from `unrealizedPL ÷ marginSize`.
3. It looks up the matching `bitget_trades` row by `tradeKey`
   (`symbol-holdSide-openedAt(ISO)`). Only trades already known **open** are
   tracked (the 5-minute reconcile creates that row).
4. `recordMilestones()` compares ROE against the row's `peakRoePct` / `troughRoePct`
   ratchets. For every newly-passed step it writes a `kind: 'system'`
   `BitgetTradeJournal` item ("🎯 Đạt mốc PnL +70% …" / "⚠️ Đạt mốc PnL −100% …")
   and advances the ratchet column.
5. The entries appear on the trade's journal timeline (the 📝 drawer on the
   /bitget positions tab), ordered by time — that ordered list is the record of
   which milestones were reached and when.

## Edge Cases

- **Peaks between polls** — the check runs every minute (not the 5-minute
  reconcile) to catch fast ROE spikes, but a spike that touches and reverts a
  milestone within a single minute can still be missed. Polling, not tick-level.
- **Jumped several steps at once** — if ROE leaps past multiple steps between
  checks (e.g. 0 → +105%), each passed step (+50, +70, +100) is logged as a
  separate item, all stamped at detection time.
- **Reversal reset** — when ROE crosses 0 the opposite ratchet column is cleared
  (`peakRoePct`/`troughRoePct` set to `null`), even if no milestone is logged that
  tick, so the next excursion in that direction re-logs from its first step. The
  reset write is idempotent (only fires when the column isn't already null).
- **Trade not yet reconciled** — if the open row does not exist yet, the position
  is skipped; when the row appears the ratchet starts from null and backfills
  every step already passed at that moment (no milestone lost, timestamp is the
  first check after the row exists).
- **Missing/zero margin or non-finite uPnL** — the position is skipped (no ROE).
- **Closed / opened-and-closed-between-polls trades** — not tracked (only
  `status = 'open'` rows); no live ROE history exists for them.
- **Credentials absent** — `syncMilestones()` returns `{ logged: 0 }` without
  calling the exchange.

## Related Files (FE / BE / Worker)

- `apps/worker/src/modules/bitget-history/bitget-history.service.ts` — `syncMilestones()`,
  `recordMilestones()`, `writeMilestoneLog()`, and the `UP_MILESTONES` /
  `DOWN_MILESTONES` constants.
- `apps/worker/src/modules/scheduler/scheduler.service.ts` — `runBitgetMilestoneSync`
  cron (every minute).
- `packages/db/src/repositories/bitget-trade.repository.ts` — `updateMilestones()`
  advances the ratchet columns.
- `packages/db/prisma/schema.prisma` — `peakRoePct` / `troughRoePct` on `BitgetTrade`.
- `packages/db/prisma/migrations/20260719160000_bitget_trade_roe_milestones/migration.sql`
  — adds the two columns.
- `apps/web/src/widgets/bitget-positions/bitget-journal-drawer.tsx` — renders the
  system milestone items on the trade timeline (existing, unchanged).
