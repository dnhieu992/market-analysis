## Description

`/my-asset` is the trader's capital ledger, denominated entirely in **USDT**. It answers two
questions: how much money is on the books in total, and how that money is split across the
places it can sit — Spot, Trading, Bitget, MEXC and Wallet by default.

Balances are never stored. Every number on the page is summed from an append-only ledger
(`asset_transactions`), so the total and the per-category figures can never drift apart, and any
past state stays reconstructible. Three actions write to that ledger:

- **Nạp (deposit)** — money moved onto an exchange/wallet. No source, one destination category.
- **Rút (withdraw)** — money moved off. One source category, no destination.
- **Chuyển (transfer)** — money moved between two categories. Total is unchanged.

Category balances are **manual**, by design — the ledger records what the trader allocated. What
that allocation is now *worth* is computed per bucket (see **Vốn triển khai** below) and reaches the
page through the allocation donut's slices.

The category set is data, not code: "+ Thêm danh mục" adds a new bucket (a new exchange, a new
wallet) and it immediately appears as a transfer target.

**This page is now the source of truth for exchange capital.** `/bitget` and `/mexc` read their
"vốn gốc" (the baseline their equity-change % is measured against) from the `bitget` and `mexc`
bucket balances here, replacing the old hardcoded `BITGET_INITIAL_CAPITAL_USD` /
`MEXC_INITIAL_CAPITAL_USD` env constants. Move capital on this page and those percentages follow
on the next fetch — no code edit, no restart.

The page also answers **"how much can I still deploy?"**:

```
available = (spot allocation − cost of coins held + realized spot PnL)
          + every cash bucket (wallet, and anything added later)
```

Algebraically the same as `total − spent on spot + realized − trading − bitget − mexc`, but built
up from the buckets that hold cash rather than subtracted down from the total — so **wallet and
any bucket the trader adds appear on the page by name** instead of being buried inside a
subtraction. A new category is spendable by default: only `trading`, `bitget` and `mexc` are
treated as committed.

`spent buying spot` is the cost basis of coins still held (`Holding.totalCost` summed across
portfolios), not the spot bucket's allocation — money sitting unspent in that bucket is still
available.

**Available is spendable cash, so only the realized half of the spot PnL enters it.** Realized PnL
is the same all-time figure `/portfolio-pnl` shows, summed from `Holding.realizedPnl` across
**all** rows including coins sold out to a zero balance (those rows are most of the total). That
is real USDT sitting in the spot account which the manual ledger never recorded, so omitting it
understates a book that has been trading profitably.

**Unrealized PnL is reported but never subtracted from available.** Paper gains and losses cannot
be deployed until the position is closed; netting them in would make available twitch with every
price tick while the actual cash balance sat still. It surfaces in the hero's `currentValueUsdt`
(mark-to-market) instead.

The two halves summed — `totalSpotPnlUsdt` — is what `/portfolio` calls a holding's all-time
profit. It is one of the two terms behind the hero's PnL display (the other is deployed PnL, see
below). Measured on live data during development: unrealized
−92.14, realized +145.80, so the spot book was **+53.67 overall** while available (cash) stood at
**284.22**.

**Available has no card of its own — it is a slice of the allocation donut.** The standalone
"USDT khả dụng" tile and its line-by-line breakdown were removed at the trader's request: cash
waiting to be deployed is an allocation like any other, and showing it twice split attention. The
API still returns every term (`spotAllocationUsdt`, `spentOnSpotUsdt`, `realizedSpotPnlUsdt`,
`liquid[]`) so the arithmetic remains auditable and a future view can render it again.

The headline **Tổng tài sản is the mark-to-market figure** `currentValueUsdt`
(`totalUsdt + spot PnL + deployed PnL`) — what is actually left after profits and losses. A single
line under it gives the change against **vốn ban đầu** (net flow = deposits − withdrawals):
`pnl = currentValueUsdt − net flow`, `% = pnl ÷ net flow`. The PnL is derived from the two numbers
on screen rather than read from `totalPnlUsdt`, so the headline always reconciles with the line
beneath it.

Everything else the hero used to carry — the deposit/withdraw/net breakdown, the ledger total, and
the spot vs deployed split of the PnL — was removed at the trader's request as noise; the ledger
total still drives the transaction table, and each deployed account appears as its own donut slice.

### Phân bổ danh mục — what the donut divides

The donut no longer divides the **ledger**; it divides the book's **current value**, the same
number the hero shows:

```
coins at market  +  available USDT  +  each deployed account at current value  =  currentValueUsdt
```

That identity holds by construction, since
`available = spotAllocation − spentOnSpot + realized + liquid` and
`deployed currentValue = capital + PnL`; substituting gives
`totalUsdt + spot PnL + deployed PnL`.

Two changes from the ledger view it replaces:

- **Spot is split per coin.** "3,163 USDT in Spot" never said how much of that was BTC. **BTC** and
  **ETH** are always named; the remaining coins fold into one **Coin khác (n)** slice — except when
  exactly one is left over, which is named rather than hidden behind "Coin khác (1)".
- **USDT khả dụng is a slice**, replacing the standalone card. It carries the wallet bucket and
  every other cash bucket, so no cash disappeared when the card did.

Coins are valued at Binance last price (`spotPositions[].marketValueUsdt`), deployed buckets at
`currentValueUsdt` — the same valuation the Vốn triển khai table reports.

Slices use the first eight slots of the validated categorical palette. The eight pass the CVD and
normal-vision floors on the adjacent pairlist a donut needs; three of them sit below 3:1 contrast on
the light surface, which the legend answers by giving every slice a text label, amount and share.

### Vốn triển khai — deployed capital, valued

**The table is not on the page right now** — the trader asked for it back out (2026-08-06), leaving
the deployed accounts visible as donut slices only. Nothing behind it was deleted: the API still
computes and returns `deployed[]` in full, and `DeployedBuckets` still renders it, so restoring the
panel is one JSX block in `my-asset.tsx`.

The three committed buckets — **Trading, Bitget, MEXC** — used to show only the amount transferred
in, which says nothing about whether that money grew or shrank. Each is now reported as
**vốn → giá trị hiện tại**, with the PnL and the return on capital:

```
current value = capital (ledger) + realized PnL + unrealized PnL
% = PnL ÷ capital
```

Each bucket names the **source** it was valued from, because a trader cross-checking against
`/bitget` or `/trades` needs to know which number they are looking at before hunting a discrepancy
that isn't one:

| Source | Meaning |
|---|---|
| `exchange` | Live account equity from the exchange — already nets off fees and funding. Used for Bitget and MEXC. |
| `sync` | The exchange call failed or has no key; falls back to closed trades mirrored into `bitget_trades` / `mexc_trades`. **Open positions are not counted**, so this is the banked half only. |
| `orders` | The manual book on `/trades`: `SUM(pnl)` over closed orders plus open orders marked to Binance last price. Used for Trading. |
| `unknown` | Nothing readable. The bucket shows its capital unchanged and prints `—` for PnL. |

For an `exchange` bucket the split is derived rather than fetched separately: equity already
contains the open-position PnL, so `unrealized = balance.unrealizedPL` and
`realized = equity − capital − unrealized`. This makes the Bitget figure agree with `/bitget`'s own
`equityChangePct`, which measures the same equity against the same ledger capital.

The **Trading** bucket counts every broker on `/trades` (BingX, Binance, OKX, …), matching the one
all-time total that page reports. Measured on live data: capital 1,363.62 → 1,507.95
(realized +225.73, unrealized −81.40) = **+10.58%**.

**Deployed PnL never enters `availableUsdt`.** That money is sitting on an exchange, not in a
spendable cash bucket; it surfaces in `currentValueUsdt` and this panel only.

### Mirrored onto the Overview dashboard

The same two figures — **Tổng tài sản** and the **Phân bổ danh mục** donut — also render on `/`
(the Overview page), directly **above** the "Total Net Worth · All Portfolios" card, so the whole
book is visible without navigating away.

`AssetSummaryCard` is a deliberate twin of that card rather than a copy of `/my-asset`'s: same
`.ps-*` markup, same `$` formatting, same 12-colour palette, same 45/72 donut radii, same
dot–name–percent legend, and the same **English** wording — two cards in different visual languages
stacked on one page read as a bug. It therefore does **not** reuse `AllocationPie` (which is styled
in `.ma-*` for the Vietnamese page); it reuses only the data functions, `buildAllocationItems()` and
`buildSlices()`, so the slice set, the ordering, the negative-value exclusion and the overflow fold
stay single-sourced and the two pages can never disagree on *what* is in the donut. The two labels
those functions generate in Vietnamese ("USDT khả dụng", "Coin khác (n)", "Khác (n)") are swapped to
English in the card — the deployed buckets are already named in English by the seed (Spot, Trading,
Bitget, MEXC, Wallet).

Right column, mirroring the sibling's eyebrow → headline → badges → P&L section → stat row:
**Total Assets · All Accounts** (`currentValueUsdt`), two badges carrying the all-time PnL in
dollars and percent, **Net Deposits** (net flow, linked to `/my-asset`), and Accounts / Available /
Deployed stat boxes.

The columns are **flipped** relative to the net-worth card: on desktop the donut takes the left
column and the total takes the right. Stacked on mobile the order swaps back
(`.ps-card--asset .ps-top-section { flex-direction: column-reverse }`) so the headline number is
still what is read first.

The two cards measure different things and are meant to sit side by side: this one is the whole
book (spot + cash + deployed accounts), the one below it is the spot portfolio only, priced
client-side from Binance.

## Main Flow

1. `GET /asset/summary` (server component, on page load) returns in one round trip:
   - `totalUsdt` — the sum of every category balance,
   - `totalDepositedUsdt` / `totalWithdrawnUsdt` — lifetime totals, summed in SQL,
   - `currentValueUsdt` — the ledger total marked to market,
   - `totalSpotPnlUsdt` / `totalDeployedPnlUsdt` / `totalPnlUsdt` — the two halves of the book's
     result and their sum,
   - `available` — `availableUsdt` plus every term it was derived from: `spotAllocationUsdt`,
     `spentOnSpotUsdt`, `spotMarketValueUsdt`, `unrealizedSpotPnlUsdt`, `realizedSpotPnlUsdt`,
     `totalSpotPnlUsdt`, `pricedPartially`, `spotPositions[]` (each held coin: `coinId`, `amount`,
     `costUsdt`, `marketValueUsdt`, `priced`), `liquid[]` (cash buckets) and `deployed[]` (each with
     `capitalUsdt`, `currentValueUsdt`, `realizedPnlUsdt`, `unrealizedPnlUsdt`, `pnlUsdt`,
     `pnlPct`, `source`, `pricedPartially`),
   - `categories` — each with its derived `balanceUsdt`,
   - `transactions` — the 200 most recent ledger rows.
2. The page renders the total tile with **Nạp / Rút / Chuyển** and the vốn-ban-đầu line, the
   allocation **donut chart + legend**, and the ledger table. (`deployed[]` is still fetched — the
   donut values its slices from it — but the Vốn triển khai table itself is currently not rendered.)
3. The trader picks an action. The dialog asks only for what that type needs: amount, the one or
   two categories involved, a date (defaults to today) and an optional note.
4. `POST /asset/transactions` validates the shape for the type, then appends one row.
5. The widget re-fetches the summary; every balance re-derives from the ledger.
6. Deleting a ledger row (`DELETE /asset/transactions/:id`) reverts its effect on the balances —
   there is no compensating entry, the row simply stops counting.

Balance maths, per category: `sum(amount where toCategoryId = c) − sum(amount where fromCategoryId = c)`.
Both sides are `groupBy` aggregates in MySQL, so the page stays correct once the ledger grows past
the 200-row display slice.

Deployed valuation runs after the balances are known (it needs each bucket's capital) and the three
buckets are valued concurrently. Every branch degrades instead of throwing: an unreachable exchange
drops to `sync`, an unreadable DB drops to `unknown`, and the bucket still renders.

Spot valuation: `Holding` rows are grouped by coin (`sumByCoin()`), priced in one Binance
`/api/v3/ticker/price` call, and summed as `amount × price`. Prices are cached 30s **per symbol**
(not per call): the spot book and the open manual orders ask for different, overlapping symbol sets
within a single summary, and the previous whole-set cache had each evict the other, costing two
Binance calls per page load and defeating the cache entirely.

Realized PnL comes from `sumRealizedPnl()`, one aggregate over the whole `Holding` table.
`/portfolio-pnl` computes the same figure a different way — replaying every `CoinTransaction` sell
as `(sellPrice − avgCost) × amount` — and the two agree to within a cent of Decimal rounding
(145.80 vs 145.79 when checked against live data).

## Edge Cases

- **Wrong endpoints for a type** — a `DEPOSIT` carrying a `fromCategoryId`, a `WITHDRAW` carrying a
  `toCategoryId`, or a `TRANSFER` missing either side is rejected with 400. The balance maths reads
  the endpoints literally, so a malformed row would silently corrupt the total.
- **Transfer into the same category** — rejected (400); it would be a no-op row that still shows in
  history.
- **Non-positive amount** — rejected in the dialog and again in the service.
- **Negative category balance** — allowed (the trader may log a withdrawal from a bucket they never
  funded). A negative slice is meaningless in a part-to-whole chart, so it is excluded from the
  donut and listed in the legend instead, greyed, with its real number still readable.
- **More than 8 allocation rows** — the donut caps at 8 slices and folds the rest into one
  "Khác (n)" slice. A 9th generated hue would not be distinguishable from an existing one; the
  legend still lists every row individually with its amount. Reaching the cap takes an unusual
  book: BTC + ETH + Coin khác + cash + three deployed buckets is seven.
- **Every balance zero** — the donut renders nothing and shows "Chưa có số dư nào để phân bổ."
- **Negative available** — not clamped. It drops out of the donut and appears greyed in the legend
  with its real (negative) number. It means more is committed than the ledger records (e.g. spot was
  bought with money never entered), and hiding that would hide a bookkeeping error. A large
  unrealized loss can no longer cause this on its own.
- **Deep unrealized loss** — available is unchanged; only `currentValueUsdt` and the coin slices
  move. The cash is still there until the position is sold.
- **A coin with no price** — its slice is drawn at cost basis (`priced: false`), so the position
  still appears at roughly the right weight instead of vanishing from the allocation.
- **A deployed bucket was deleted** — it simply drops out of the `deployed[]` list and stops being
  subtracted; the number stays computable.
- **Exchange API key missing or the balance call fails** — the bucket falls back to the closed
  trades already mirrored in our DB and is labelled `sync`, which is honest about excluding open
  positions rather than silently reporting a stale-looking total as complete.
- **Neither the exchange nor the DB can be read** — `source: 'unknown'`, `pnlUsdt: null`, and the
  table prints `—`. "We don't know" and "it broke even" are different answers, so an unknown PnL
  is never rendered as 0.
- **A deployed bucket with 0 capital** — the PnL is still shown but `pnlPct` is `null`: the return
  has no denominator, and printing 0% would read as "flat" when it means "nothing was put in".
  The totals row divides only by the capital of buckets that could actually be valued, so an
  unknown bucket's capital cannot dilute a measured return.
- **An open manual order with no `quantity`, or a symbol Binance does not list** — skipped rather
  than valued at 0, with `pricedPartially` true so the row says the number is incomplete.
- **The mirrored-trade tables only keep a rolling window** — `sync` can therefore understate a
  long-running account's realized total. This is why live equity is always preferred when the key
  works.
- **Bitget manual orders on `/trades`** — the three April `broker='BITGET'` rows predate the
  `bitget` bucket (whose synced history starts July), so counting every broker in the Trading
  bucket does not double-count today. A *new* manual order logged against an exchange that also
  reports live equity would be counted twice; log those on the exchange page, not `/trades`.
- **A brand-new bucket** — lands in `liquid[]` and counts as available in full. Treating unknown
  buckets as committed would silently hide money the trader just recorded.
- **The `spot` bucket was deleted** — `spotAllocationUsdt` is 0 while the cost of held coins is
  still subtracted, so available goes negative. That is the honest reading: coins are held against
  an allocation that no longer exists on the books.
- **Holdings table unreadable** — the spot terms fall back to 0 rather than failing the summary.
- **Binance price call fails** — every coin is valued at its own cost, so unrealized PnL is 0 and
  available degrades to the cost-basis behaviour instead of erroring. `pricedPartially` goes true
  and the page says so.
- **A held coin Binance does not list** — valued at cost, contributing 0 PnL, rather than being
  dropped (which would silently inflate available) or zeroed (which would wipe the position).
  `pricedPartially` flags it.
- **Stablecoin holdings** (USDT/USDC/BUSD/DAI/TUSD/FDUSD) — valued 1:1 without a price lookup;
  Binance lists no `USDTUSDT` pair, so asking would falsely mark them unpriced.
- **Fully sold-out coin** — `sumByCoin()` drops zero-amount rows so it contributes no market
  value, but its **realized PnL still counts**: `sumRealizedPnl()` deliberately spans every row.
  Filtering those out was the original bug — it silently discarded most of the banked profit.
- **Nothing held at all** — market value and unrealized PnL are 0, but realized PnL from past
  sells is still added, so available reflects profit taken before closing everything out.
- **Deleting a category that still has history** — rejected with 409 and the count of blocking rows.
  The FK is `onDelete: Restrict`, so the database enforces this even if the check is bypassed.
- **Duplicate category key** — rejected with 409. Keys are slugified from the label
  ("Binance Spot" → `binance-spot`) and validated against `^[a-z0-9][a-z0-9_-]*$` on the server.
- **Category `key` is immutable** — `PATCH` updates the label and sort order only, so renaming a
  bucket never breaks code that looks it up by key.
- **Date handling** — the date input is date-only; it is submitted as noon local time so a timezone
  shift cannot move an entry to the previous day.
- **API down on page load** — the server component falls back to an empty summary and the page
  renders with zeros instead of crashing.
- **API error messages** — asset mutations go through `assetMutation()` in the web client, which
  rethrows the server's own Vietnamese `message` so the dialog shows the actual rule that failed,
  not an HTTP status.

## Related Files (FE / BE / Worker)

**Web (FE)**
- `apps/web/src/app/my-asset/page.tsx` — route, thin re-export
- `apps/web/src/_pages/my-asset-page/my-asset-page.tsx` — server component; fetches the summary
- `apps/web/src/widgets/my-asset/my-asset.tsx` — total tile (+ vốn-ban-đầu line), ledger table;
  builds the donut's rows via `buildAllocationItems()`
- `apps/web/src/widgets/my-asset/asset-transaction-dialog.tsx` — Nạp / Rút / Chuyển form
- `apps/web/src/widgets/my-asset/add-category-dialog.tsx` — add a bucket, with label→key slugify
- `apps/web/src/widgets/my-asset/allocation-pie.tsx` — recharts donut + legend;
  `buildAllocationItems()` composes coins + available cash + deployed accounts, `buildSlices()` does
  the ordering, the negative-value exclusion and the 8-slice fold
- `apps/web/src/widgets/my-asset/allocation-pie.spec.ts` — 10 cases over both functions
- `apps/web/src/widgets/my-asset/deployed-buckets.tsx` — the **Vốn triển khai** table (vốn → giá trị
  hiện tại, PnL, %, source label); `summarizeDeployed()` does the totals row. Currently not mounted
  by `my-asset.tsx` — kept ready to drop back in
- `apps/web/src/widgets/my-asset/deployed-buckets.spec.ts` — 5 cases over `summarizeDeployed()`
- `apps/web/src/widgets/asset-summary-card/asset-summary-card.tsx` — the Overview mirror of the
  total + donut (donut left, total right), styled and worded as a twin of `HoldingsAllocationChart`;
  reuses `buildAllocationItems()` / `buildSlices()` for the data only
- `apps/web/src/_pages/overview-page/overview-page.tsx` — fetches the summary alongside the
  dashboard data; a failed call drops the card instead of blanking the page
- `apps/web/src/widgets/dashboard-overview/dashboard-overview.tsx` — mounts the card above
  `HoldingsAllocationChart`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav item, placed directly under Overview
- `apps/web/src/shared/api/client.ts` — `fetchAssetSummary`, `createAssetTransaction`,
  `deleteAssetTransaction`, `createAssetCategory`, `updateAssetCategory`, `deleteAssetCategory`,
  and the `assetMutation()` error-surfacing helper
- `apps/web/src/shared/api/types.ts` — `AssetCategory`, `AssetTransaction`, `AssetSummary`,
  `AssetAvailable`, `AssetSpotPosition`, `AssetDeployed`, `AssetDeployedValue`, `AssetDeployedSource`
- `apps/web/src/app/globals.css` — `.ma-*` styles

**API (BE)**
- `apps/api/src/modules/asset/asset.controller.ts` — `/asset/summary`, `/asset/transactions`,
  `/asset/categories`
- `apps/api/src/modules/asset/asset.service.ts` — balance derivation and all validation rules
- `apps/api/src/modules/asset/dto/create-asset-transaction.dto.ts`
- `apps/api/src/modules/asset/dto/create-asset-category.dto.ts`
- `apps/api/src/modules/asset/dto/update-asset-category.dto.ts`
- `apps/api/src/app.module.ts` — registers `AssetModule`
- `apps/api/src/modules/market/binance-market-data.service.ts` — `fetchCurrentPrices()`, the batch
  price read (pulls the full ticker list and filters locally: Binance 400s a `symbols=[…]` batch
  containing any unlisted pair)
- `apps/api/src/modules/asset/asset.module.ts` — registers `BinanceMarketDataService`,
  `BitgetTradeClient` and `MexcTradeClient` for injection
- `apps/api/src/modules/bitget/bitget-trade.client.ts` — `getAccountBalance()`, the live Bitget equity
- `apps/api/src/modules/mexc/mexc-trade.client.ts` — `getAccountBalance()`, the live MEXC equity
- `apps/api/test/asset.service.spec.ts` — balance derivation, `availableUsdt`, spot
  mark-to-market, per-coin `spotPositions`, realized PnL, deployed-bucket valuation and every
  validation rule (44 cases)
- `apps/api/test/stubs/app-db.ts` — in-memory asset ledger used by that spec, plus
  `__setTradingBook()` / `__setExchangeRealizedPnl()` for the deployed cases

**DB**
- `packages/db/prisma/schema.prisma` — `AssetCategory`, `AssetTransaction`
- `packages/db/prisma/migrations/20260805120000_add_asset_tracking/migration.sql` — tables, FKs,
  and the seed for the five default categories
- `packages/db/src/repositories/asset.repository.ts` — `createAssetCategoryRepository`
  (incl. `balanceByKey`, read by /bitget and /mexc for their capital),
  `createAssetTransactionRepository` (incl. `sumBalances`, `sumByType`)
- `packages/db/src/repositories/holding.repository.ts` — `sumTotalCost()` (spot-spend term),
  `sumByCoin()` (per-coin amounts, for market valuation) and `sumRealizedPnl()` (banked profit)
- `packages/db/src/repositories/order.repository.ts` — `allTimePnlSummary()`, the unfiltered
  closed-PnL total + open orders that value the `trading` bucket
- `packages/db/src/repositories/bitget-trade.repository.ts` — `sumRealizedPnl()`, the `sync` fallback
- `packages/db/src/repositories/mexc-trade.repository.ts` — `sumRealizedPnl()`, the `sync` fallback
- `apps/api/src/modules/portfolio/portfolio.service.ts` — `getPnlCalendar()`, the /portfolio-pnl
  figure this page's realized term is cross-checked against

**Consumers of this page's data**
- `apps/api/src/modules/bitget/bitget.service.ts` — `capitalUsd()` reads the `bitget` bucket
- `apps/api/src/modules/mexc/mexc.service.ts` — `capitalUsd()` reads the `mexc` bucket

**Worker** — not involved; this feature has no scheduled component.
