## Description

The `BTC Accumulated` and `ETH Accumulated` cards on the Overview page (`/`) track progress toward
the long-term DCA goals (1 BTC, 10 ETH). They read **one portfolio only** — the DCA plan portfolio
`BTC&ETH(70%)` (`1cf1569e-2f47-4125-b004-cd27f9521a3a`) — not the sum of every portfolio.

The reason is that short-term trading now lives in its own `TRADING` portfolio. A 0.0001 BTC scalp
opened and closed there is not accumulation, and before this change it was added to the card and
moved the "% toward 1 BTC" number. The two figures answer different questions, so they read
different books.

The portfolio id is a constant with an env override, `NEXT_PUBLIC_ACCUMULATION_PORTFOLIO_ID`. Being
a `NEXT_PUBLIC_*` var it is baked in at build time — changing it requires a rebuild of `web`, not
just a pm2 restart.

**Only these two cards are scoped.** The Capital Allocation donut, net worth, and `Total Profit /
Loss` still aggregate every portfolio, which is what they are for.

## Main Flow

1. `loadDashboardData()` fetches all portfolios and their holdings in parallel (unchanged).
2. It aggregates every portfolio's holdings by `coinId` into `allHoldings` — this feeds
   `HoldingsAllocationChart`.
3. Separately it picks out the holdings array of the accumulation portfolio and maps it to
   `accumulationHoldings` with no cross-portfolio merge.
4. `OverviewPage` looks up `BTC` and `ETH` in `accumulationHoldings` and passes amount, cost and
   average cost to `buildOverviewCards()`.
5. Each card's `href` points at `/portfolio/<accumulation-id>/<COIN>`, so clicking it lands on the
   DCA plan's coin page rather than whichever portfolio happened to be first.

## Edge Cases

- **The configured portfolio does not exist** (deleted, wrong id, or another user's) — `findIndex`
  returns `-1`, `accumulationHoldings` is empty, and both cards render `--` with 0% progress. The
  rest of the dashboard is unaffected.
- **Holdings fetch fails for that portfolio** — the per-portfolio `.catch(() => [])` already yields
  an empty array, same outcome as above.
- **The coin is fully sold in that portfolio** (amount 0) — the card shows `--`; `livePrice` is
  omitted because it requires `totalAmount > 0`, so no Binance polling for a zero position.
- **The same coin is held in the trading portfolio** — it appears in the Capital Allocation donut
  and net worth, but never in the accumulation cards.
- **Whole `loadDashboardData()` failure** — the catch branch returns `accumulationHoldings: []`
  alongside the other empty defaults.

## Related Files (FE / BE / Worker)

- `apps/web/src/_pages/overview-page/overview-page.tsx` — `ACCUMULATION_PORTFOLIO_ID` constant,
  builds `accumulationHoldings`, and feeds the two cards from it
- `apps/web/src/widgets/dashboard-overview/dashboard-overview.tsx` — renders the cards; still
  receives the all-portfolio `allHoldings` for the allocation chart
- `apps/web/src/shared/api/client.ts` — `fetchPortfolios()` / `fetchHoldings(portfolioId)`
- `apps/api/src/modules/holdings/*` — computes per-portfolio holdings from `transactions`
