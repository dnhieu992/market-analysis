## Description

The Overview page (`/`) refreshes itself every **15 seconds** instead of showing whatever was true
when it was opened. It is the page the trader leaves on a second monitor, and every figure on it —
total assets, net worth, the allocation donuts, the 24h badges, realized PnL — is either a live
price or a number a bot can move without the trader touching the browser.

15s is not a new number: `bitget-positions`, `bitget-history`, `mexc-positions`, `mexc-history`
and both setup feeds already poll at `REFRESH_MS = 15_000`. `DASHBOARD_POLL_MS` in
`shared/lib/use-poll.ts` is the same cadence, named once so the overview's feeds stay in step
with each other.

Two independent refresh paths, because the page draws from two kinds of source:

| Path | Refreshes | Driven by |
|---|---|---|
| `router.refresh()` | Everything the server component fetches: orders, realized PnL (incl. Bitget/MEXC), portfolios, holdings, the asset summary | `AutoRefresh` |
| Direct Binance fetch | Spot prices and 24h tickers behind the net-worth card | `HoldingsAllocationChart` |

The server path is one `router.refresh()` rather than a fetch per widget: the six endpoints behind
this page are already composed by `loadDashboardData()`, and re-doing that composition on the
client would duplicate it. React keeps client state across a refresh, so an open dialog stays open
and half-typed input survives a tick.

`BTC Accumulated` / `ETH Accumulated` were already live — `LivePriceInfo` polls a single Binance
symbol every 5s and is left alone.

**Polling stops while the tab is hidden.** `usePoll` skips a tick when `document.hidden` and fires
one immediately on `visibilitychange`, so a tab left open overnight does no work and is still
current the moment it is looked at — rather than showing up to 15s of stale numbers first.

### Cost of a tick

`router.refresh()` re-runs `loadDashboardData()`, which is cheap where it matters: the Bitget and
MEXC history endpoints read `bitget_trades` / `mexc_trades` from MySQL (`findRecentClosed`), not
the exchanges. The one call that does reach out is `/asset/summary`, which asks Bitget and MEXC for
account equity and Binance for spot prices — the latter behind a 30s per-symbol server cache, so
every other tick is served from memory. The exchange balance calls are the same rate the
`/bitget` and `/mexc` position feeds already run at.

## Main Flow

1. The Overview server component renders and mounts `AutoRefresh` (renders nothing) alongside the
   cards.
2. Every 15s, if the tab is visible, `AutoRefresh` calls `router.refresh()`.
3. Next re-runs the server component, which re-fetches everything through `loadDashboardData()` and
   streams fresh props into the mounted client components.
4. `AssetSummaryCard` adopts each new `summary` prop into its local state, so the total, the badges
   and its donut all move.
5. In parallel, `HoldingsAllocationChart` re-fetches Binance prices and 24h tickers on the same
   15s poll and recomputes net worth, the chart, and every top/gainer/loser list.

## Edge Cases

- **Tab hidden** — no ticks at all. On becoming visible again one fires immediately, so the trader
  never reads a stale number while waiting out the remainder of an interval.
- **A refresh lands while a dialog is open** — the dialog stays open and keeps its input; client
  state survives `router.refresh()`. The card behind it updates.
- **A mutation and a tick race** — both write the same shape from the same endpoint, so last write
  wins and either is correct. The card keeps its own state (rather than reading the prop directly)
  precisely so a deposit shows instantly instead of waiting up to 15s for the next tick.
- **`holdings` identity changes on every tick** — it is a fresh array from the server even when
  nothing moved. `HoldingsAllocationChart` keys its re-price effect on a **content signature**
  (`coinId:amount:cost:realizedPnl` joined), so the server tick does not fire a second Binance
  fetch on top of the poll's.
- **Binance unreachable** — `fetchPrices` / `fetch24hTickers` already return `{}` on failure; the
  next tick tries again. The chart keeps the last good numbers rather than blanking.
- **The API is down** — `loadDashboardData()` catches and returns its empty shape, so a tick can
  visibly zero the page. It recovers on the next successful tick.
- **Two tabs open** — each polls independently. Nothing is shared or coordinated; the load is one
  refresh per visible tab per 15s.

## Related Files (FE / BE / Worker)

**Web (FE)**
- `apps/web/src/shared/lib/use-poll.ts` — `usePoll()` (interval + hidden-tab rules, task held in a
  ref so inline closures do not restart the timer) and the shared `DASHBOARD_POLL_MS = 15_000`
- `apps/web/src/widgets/dashboard-overview/auto-refresh.tsx` — `AutoRefresh`, the null-rendering
  client component that calls `router.refresh()` on the interval
- `apps/web/src/widgets/dashboard-overview/dashboard-overview.tsx` — mounts `AutoRefresh`
- `apps/web/src/widgets/holdings-allocation-chart/holdings-allocation-chart.tsx` — `reprice()`
  extracted into a `useCallback`, run by the poll and by the content-signature effect
- `apps/web/src/widgets/asset-summary-card/asset-summary-card.tsx` — adopts each refreshed
  `summary` prop into local state
- `apps/web/src/widgets/dashboard-overview/live-price-info.tsx` — the pre-existing 5s single-symbol
  price poll on the BTC/ETH cards; unchanged
- `apps/web/src/_pages/overview-page/overview-page.tsx` — `loadDashboardData()`, re-run by every
  tick

**API (BE)** — no changes. The tick calls existing endpoints: `/orders`, `/analysis-runs`,
`/portfolios`, `/portfolios/:id/holdings`, `/bitget/history`, `/mexc/history`, `/asset/summary`.

**Worker** — not involved.
