## Description

> **The `/my-asset` page no longer exists (removed 2026-08-06).** Its route, server component and
> page widget were deleted; the whole feature now lives in the **asset card on the overview** (`/`),
> which carries the total, the allocation donut and four buttons — **Deposit / Withdraw /
> Transfer / History** — opening the same dialogs the page used. Nothing behind it changed: the API, the
> ledger, `AssetSummary` and every rule below are untouched. Read "/my-asset" in the rest of this
> document as "the asset ledger".

The asset ledger is the trader's capital book, denominated entirely in **USDT**. It answers two
questions: how much money is on the books in total, and how that money is split across the
places it can sit — Spot, Trading, Bitget, MEXC, OKX and Wallet by default.

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

**This page is now the source of truth for exchange capital.** `/bitget`, `/mexc` and `/okx` read
their "vốn gốc" (the baseline their equity-change % is measured against) from the `bitget`, `mexc`
and `okx` bucket balances here, replacing the old hardcoded `BITGET_INITIAL_CAPITAL_USD` /
`MEXC_INITIAL_CAPITAL_USD` / `OKX_INITIAL_CAPITAL_USD` env constants. Move capital on this page
and those percentages follow on the next fetch — no code edit, no restart.

The page also answers **"how much can I still deploy?"**:

```
available = (spot allocation − cost of coins held + realized spot PnL)
          + every cash bucket (wallet, and anything added later)
```

Algebraically the same as `total − spent on spot + realized − trading − bitget − mexc − okx`, but built
up from the buckets that hold cash rather than subtracted down from the total — so **wallet and
any bucket the trader adds appear on the page by name** instead of being buried inside a
subtraction. A new category is spendable by default: only `trading`, `bitget`, `mexc` and `okx`
are treated as committed (`DEPLOYED_KEYS` in `asset.service.ts`).

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

**`buildSlices()` emits a fixed order, not ranked by size:** cash first, then the named coins (BTC,
then ETH, driven off `NAMED_COINS` rather than the API's position order), then each deployed bucket
in the order the API returns them (Trading, Bitget, MEXC, OKX), then the leftover coins last. It
preserves the order `buildAllocationItems()` emits; only the 8-slice overflow still looks at value,
folding the *smallest* rows away so a large position can never be hidden for sitting late in the
list. The Overview card re-sorts this output descending by value (see below) — the function itself
stays order-preserving so the ranking is one caller's presentation choice, not baked into the data.

`buildSlices()` assigns the first eight slots of the validated categorical palette. The card then
overrides them with the overview's own 12-colour ramp so both donuts on that page speak one colour
language; the palette stays in `buildSlices` because a slice without a colour is a half-built row
and the function is the tested seam. Either way the legend gives every slice a text label, an
amount and a share, so nothing depends on colour alone.

### Vốn triển khai — deployed capital, valued

**The table is not rendered anywhere right now** — the trader asked for it back out (2026-08-06),
leaving the deployed accounts visible as donut slices only. Nothing behind it was deleted: the API
still computes and returns `deployed[]` in full, and `DeployedBuckets` still renders it, so bringing
it back is one JSX block — now in `asset-summary-card.tsx` or a dialog of its own, since the page it
used to sit on is gone.

The four committed buckets — **Trading, Bitget, MEXC, OKX** — used to show only the amount
transferred in, which says nothing about whether that money grew or shrank. Each is now reported as
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
| `exchange` | Live account equity from the exchange — already nets off fees and funding. Used for Bitget, MEXC and OKX. |
| `sync` | The exchange call failed or has no key; falls back to closed trades mirrored into `bitget_trades` / `mexc_trades` / `okx_trades`. **Open positions are not counted**, so this is the banked half only. |
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

### The asset card on the Overview dashboard

The total and the allocation donut render on `/` (the Overview page), directly **above** the
"Total Net Worth · All Portfolios" card. This started as a mirror of `/my-asset` and then replaced
it outright: the page was removed and its nav entry with it, so the card is the only way in.

`AssetSummaryCard` is a deliberate twin of that card rather than a copy of `/my-asset`'s: same
`.ps-*` markup, same `$` formatting, same 12-colour palette, same 45/72 donut radii, same
dot–name–percent legend, and the same **English** wording — two cards in different visual languages
stacked on one page read as a bug. It therefore does **not** reuse `AllocationPie` (which is styled
in `.ma-*` for the Vietnamese page); it reuses only the data functions, `buildAllocationItems()` and
`buildSlices()`, so the slice set, the negative-value exclusion and the overflow fold stay
single-sourced and the two pages can never disagree on *what* is in the donut. The labels
those functions generate in Vietnamese ("USDT khả dụng", "Coin khác (n)", "Khác (n)") are swapped to
English in the card — cash renders as plain **USDT**, so the row reads as one more ticker next to
BTC and ETH. The deployed buckets are already named in English by the seed (Spot, Trading, Bitget,
MEXC, OKX, Wallet).

The column split matches the sibling exactly — **total left, donut right**. The left column follows
its eyebrow → headline → badges → P&L-section rhythm: **Total Assets · All Accounts**
(`currentValueUsdt`), two badges carrying the all-time PnL in dollars and percent, and **Net
Deposits** (net flow, linked to `/my-asset`). There is no stat row; Accounts / Available / Deployed
tiles were dropped at the trader's request — available and each deployed account are already slices
of the donut, so the tiles only said the same thing twice.

**Slices are ranked largest first** (2026-08-19, at the trader's request), so the legend reads as a
size ranking and the eye lands on the biggest exposure first. This overrides `buildSlices()`'s fixed
order for this card only, and it is the trade-off the fixed order was protecting against: a row can
now change position when a price moves. The folded **Other (n)** bucket stays pinned last regardless
of its value — it is a remainder, not a holding, so ranking it against named rows would read as a
real position. The 12-colour ramp is applied *after* the sort, so colours run in rank order too.

Each legend row carries its **dollar amount** next to the name — `BTC ($1,700)` — because a
percentage alone does not answer "how much is in BTC right now". The amount rides inside the name
cell so the legend keeps the sibling's dot–name–percent three-column rhythm.

Under the total sit the four ledger actions: **Deposit**, **Withdraw**, **Transfer** open
`AssetTransactionDialog` with the matching type, and **History** opens `AssetHistoryDialog` — the
ledger table lifted out of the deleted page, with the same per-row delete. Every mutation calls
`fetchAssetSummary()` and drops the result into the card's local state, so the headline, the badges
and the donut all move together without a route reload.

**"+ Thêm danh mục" now lives inside the History dialog.** The trader asked for four buttons, and a
fifth top-level action for something used once a quarter would not have earned its place — but with
the page gone this was the last remaining way to add a bucket, and a category is a ledger concern.
Opening it swaps the History dialog for the category form and saving swaps back, so the trader
lands where they started with the new bucket already loaded.

**All three dialogs are portalled to `document.body`.** `.ps-card` sets `backdrop-filter`, which
makes it the containing block for `position: fixed` descendants — a dialog rendered in place would
be trapped inside the card instead of covering the viewport. This is why `AssetTransactionDialog`
and `AddCategoryDialog` gained `createPortal` when they moved off the page, where no ancestor had
filtered them.

The two cards measure different things and are meant to sit side by side: this one is the whole
book (spot + cash + deployed accounts), the one below it is the spot portfolio only, priced
client-side from Binance.

## Main Flow

1. `GET /asset/summary` (the overview's server component, on page load) returns in one round trip:
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
2. The card renders the total, the all-time PnL badges, net deposits, the four action buttons and
   the allocation **donut + legend**. (`deployed[]` is still fetched — the donut values its slices
   from it — but the Vốn triển khai table itself is not rendered anywhere.)
3. The trader picks an action. Deposit / Withdraw / Transfer open the dialog, which asks only for
   what that type needs: amount, the one or two categories involved, a date (defaults to today) and an
   optional note. History opens the ledger table instead.
4. `POST /asset/transactions` validates the shape for the type, then appends one row.
5. The card re-fetches the summary into local state; every balance re-derives from the ledger, and
   the headline, badges and donut update together.
6. Deleting a ledger row from the History dialog (`DELETE /asset/transactions/:id`) reverts its
   effect on the balances — there is no compensating entry, the row simply stops counting.

Balance maths, per category: `sum(amount where toCategoryId = c) − sum(amount where fromCategoryId = c)`.
Both sides are `groupBy` aggregates in MySQL, so the page stays correct once the ledger grows past
the 200-row display slice.

Deployed valuation runs after the balances are known (it needs each bucket's capital) and the four
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
  book: BTC + ETH + Coin khác + cash + the four deployed buckets is exactly eight.
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
- **An exchange bucket missing from `DEPLOYED_KEYS`** — this is what happened to OKX
  (fixed 2026-08-17). The `okx` category existed and the trader transferred into it, but because
  the key was not listed the balance took the "brand-new bucket" path above: it was counted as cash
  and folded into the USDT slice, so no OKX slice ever appeared on the donut and its equity was
  never marked to market. Adding an exchange to the book is therefore two edits — the key here and
  its client in `asset.module.ts` — not just a new category row.
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
- **API down on page load** — the summary call has its own `.catch` inside the overview's
  loader, so the asset card is dropped entirely rather than the dashboard rendering with zeros or
  blanking. The rest of the overview is unaffected.
- **A dialog opened from the card** — all three are portalled to `document.body`. `.ps-card` sets
  `backdrop-filter`, which makes it the containing block for `position: fixed` children; rendered
  in place, the backdrop would cover only the card. This bit before, on a different card.
- **Adding a category from the History dialog** — the History dialog closes while the form is open
  and reopens on save or cancel, so the trader is never left on the bare dashboard wondering where
  the ledger went. The refresh runs before the reopen, so the new bucket is already listed.
- **Deleting the last transaction from the History dialog** — the table empties in place and shows
  "Chưa có giao dịch nào"; the card behind it re-derives to zeros rather than going stale.
- **API error messages** — asset mutations go through `assetMutation()` in the web client, which
  rethrows the server's own Vietnamese `message` so the dialog shows the actual rule that failed,
  not an HTTP status.

## Related Files (FE / BE / Worker)

**Web (FE)**
- `apps/web/src/widgets/asset-summary-card/asset-summary-card.tsx` — **the whole feature's UI**:
  total + badges + net deposits left, donut right, the four ledger buttons, and the dialog state
  machine. Styled and worded as a twin of `HoldingsAllocationChart`; reuses
  `buildAllocationItems()` / `buildSlices()` for the data only
- `apps/web/src/widgets/my-asset/asset-transaction-dialog.tsx` — Nạp / Rút / Chuyển form, portalled
- `apps/web/src/widgets/my-asset/asset-history-dialog.tsx` — the ledger table (per-row delete) plus
  "+ Thêm danh mục"; portalled
- `apps/web/src/widgets/my-asset/add-category-dialog.tsx` — add a bucket, with label→key slugify;
  portalled, and returns to the History dialog on close or save
- `apps/web/src/widgets/my-asset/allocation-pie.ts` — data only since the page went: 
  `buildAllocationItems()` composes coins + available cash + deployed accounts, `buildSlices()` does
  the ordering, the negative-value exclusion and the 8-slice fold. The `AllocationPie` renderer was
  deleted with its only caller
- `apps/web/src/widgets/my-asset/allocation-pie.spec.ts` — 12 cases over both functions
- `apps/web/src/widgets/my-asset/deployed-buckets.tsx` — the **Vốn triển khai** table (vốn → giá trị
  hiện tại, PnL, %, source label); `summarizeDeployed()` does the totals row. Not mounted anywhere —
  kept, with its spec, for when the panel comes back
- `apps/web/src/widgets/my-asset/deployed-buckets.spec.ts` — 5 cases over `summarizeDeployed()`
- `apps/web/src/_pages/overview-page/overview-page.tsx` — fetches the summary alongside the
  dashboard data; a failed call drops the card instead of blanking the page
- `apps/web/src/widgets/dashboard-overview/dashboard-overview.tsx` — mounts the card above
  `HoldingsAllocationChart`
- **Deleted 2026-08-06**: `apps/web/src/app/my-asset/page.tsx`,
  `apps/web/src/_pages/my-asset-page/my-asset-page.tsx`,
  `apps/web/src/widgets/my-asset/my-asset.tsx`, and the "My Asset" entry in
  `apps/web/src/widgets/app-shell/sidebar-nav.tsx`
- `apps/web/src/shared/api/client.ts` — `fetchAssetSummary`, `createAssetTransaction`,
  `deleteAssetTransaction`, `createAssetCategory`, `updateAssetCategory`, `deleteAssetCategory`,
  and the `assetMutation()` error-surfacing helper
- `apps/web/src/shared/api/types.ts` — `AssetCategory`, `AssetTransaction`, `AssetSummary`,
  `AssetAvailable`, `AssetSpotPosition`, `AssetDeployed`, `AssetDeployedValue`, `AssetDeployedSource`
- `apps/web/src/app/globals.css` — `.ps-actions` (the button row) and the surviving `.ma-*`
  styles: the dialog form fields, the ledger table, and the type pills. The page-only blocks
  (`.ma-hero*`, `.ma-total`, `.ma-panel`, `.ma-donut-row`, `.ma-chart-wrap`, `.ma-legend*`,
  `.ma-pnl*`) went with the page

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
  `BitgetTradeClient`, `MexcTradeClient` and `OkxTradeClient` for injection
- `apps/api/src/modules/bitget/bitget-trade.client.ts` — `getAccountBalance()`, the live Bitget equity
- `apps/api/src/modules/mexc/mexc-trade.client.ts` — `getAccountBalance()`, the live MEXC equity
- `apps/api/src/modules/okx/okx-trade.client.ts` — `getAccountBalance()`, the live OKX equity (USDT
  trading account)
- `apps/api/test/asset.service.spec.ts` — balance derivation, `availableUsdt`, spot
  mark-to-market, per-coin `spotPositions`, realized PnL, deployed-bucket valuation and every
  validation rule (47 cases, incl. the OKX bucket)
- `apps/api/test/stubs/app-db.ts` — in-memory asset ledger used by that spec, plus
  `__setTradingBook()` / `__setExchangeRealizedPnl()` for the deployed cases

**DB**
- `packages/db/prisma/schema.prisma` — `AssetCategory`, `AssetTransaction`
- `packages/db/prisma/migrations/20260805120000_add_asset_tracking/migration.sql` — tables, FKs,
  and the seed for the five default categories
- `packages/db/prisma/migrations/20260817130000_seed_okx_asset_category/migration.sql` — seeds the
  `okx` bucket (idempotent; it predated only as a hand-created row on the server)
- `packages/db/src/repositories/asset.repository.ts` — `createAssetCategoryRepository`
  (incl. `balanceByKey`, read by /bitget, /mexc and /okx for their capital),
  `createAssetTransactionRepository` (incl. `sumBalances`, `sumByType`)
- `packages/db/src/repositories/holding.repository.ts` — `sumTotalCost()` (spot-spend term),
  `sumByCoin()` (per-coin amounts, for market valuation) and `sumRealizedPnl()` (banked profit)
- `packages/db/src/repositories/order.repository.ts` — `allTimePnlSummary()`, the unfiltered
  closed-PnL total + open orders that value the `trading` bucket
- `packages/db/src/repositories/bitget-trade.repository.ts` — `sumRealizedPnl()`, the `sync` fallback
- `packages/db/src/repositories/mexc-trade.repository.ts` — `sumRealizedPnl()`, the `sync` fallback
- `packages/db/src/repositories/okx-trade.repository.ts` — `sumRealizedPnl()`, the `sync` fallback
- `apps/api/src/modules/portfolio/portfolio.service.ts` — `getPnlCalendar()`, the /portfolio-pnl
  figure this page's realized term is cross-checked against

**Consumers of this page's data**
- `apps/api/src/modules/bitget/bitget.service.ts` — `capitalUsd()` reads the `bitget` bucket
- `apps/api/src/modules/mexc/mexc.service.ts` — `capitalUsd()` reads the `mexc` bucket

**Worker** — not involved; this feature has no scheduled component.
