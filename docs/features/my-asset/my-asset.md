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

Category balances are **manual**, by design — the page does not read live equity from Bitget or
MEXC. It records what the trader allocated, not what the position is currently worth.

The category set is data, not code: "+ Thêm danh mục" adds a new bucket (a new exchange, a new
wallet) and it immediately appears as a transfer target.

**This page is now the source of truth for exchange capital.** `/bitget` and `/mexc` read their
"vốn gốc" (the baseline their equity-change % is measured against) from the `bitget` and `mexc`
bucket balances here, replacing the old hardcoded `BITGET_INITIAL_CAPITAL_USD` /
`MEXC_INITIAL_CAPITAL_USD` env constants. Move capital on this page and those percentages follow
on the next fetch — no code edit, no restart.

The page also answers **"how much can I still deploy?"**:

```
available = total − spent buying spot + spot PnL (realized + unrealized)
            − trading − bitget − mexc
```

`spent buying spot` is the cost basis of coins still held (`Holding.totalCost` summed across
portfolios), not the spot bucket's allocation — money sitting unspent in that bucket is still
available.

**Both halves of the spot PnL are required**, and each fixes a different way the number lies:

- **Unrealized** (`market value − cost`, at Binance last price). Without it, a position that has
  halved is still reported as fully funded.
- **Realized** — the same all-time figure `/portfolio-pnl` shows, summed from `Holding.realizedPnl`
  across **all** rows including coins sold out to a zero balance (those rows are most of the
  total). This is real USDT sitting in the spot account that the manual ledger never recorded, so
  omitting it understates a book that has been trading profitably.

Their sum is what `/portfolio` calls a holding's all-time profit. Measured on real data during
development: unrealized −90.98 but realized +145.80, so the spot book was **+54.83 overall** while
an unrealized-only calculation showed a loss.

The breakdown is rendered line by line beside the number, because an "available" figure the trader
cannot reconcile is one they will not trust.

The headline **Tổng tài sản stays the ledger figure** — it is what Nạp/Rút move, and it must not
drift with the market. Mark-to-market appears next to it as `currentValueUsdt`
(`totalUsdt + unrealized spot PnL`) with the PnL and its %.

## Main Flow

1. `GET /asset/summary` (server component, on page load) returns in one round trip:
   - `totalUsdt` — the sum of every category balance,
   - `totalDepositedUsdt` / `totalWithdrawnUsdt` — lifetime totals, summed in SQL,
   - `currentValueUsdt` — the ledger total marked to market,
   - `available` — `availableUsdt` plus every term it was derived from: `spentOnSpotUsdt`,
     `spotMarketValueUsdt`, `unrealizedSpotPnlUsdt`, `realizedSpotPnlUsdt`, `totalSpotPnlUsdt`,
     `pricedPartially` and `deployed[]`,
   - `categories` — each with its derived `balanceUsdt`,
   - `transactions` — the 200 most recent ledger rows.
2. The page renders the total tile with **Nạp / Rút / Chuyển**, the **USDT khả dụng** tile with its
   breakdown, an allocation **donut chart + legend**, and the ledger table.
3. The trader picks an action. The dialog asks only for what that type needs: amount, the one or
   two categories involved, a date (defaults to today) and an optional note.
4. `POST /asset/transactions` validates the shape for the type, then appends one row.
5. The widget re-fetches the summary; every balance re-derives from the ledger.
6. Deleting a ledger row (`DELETE /asset/transactions/:id`) reverts its effect on the balances —
   there is no compensating entry, the row simply stops counting.

Balance maths, per category: `sum(amount where toCategoryId = c) − sum(amount where fromCategoryId = c)`.
Both sides are `groupBy` aggregates in MySQL, so the page stays correct once the ledger grows past
the 200-row display slice.

Spot valuation: `Holding` rows are grouped by coin (`sumByCoin()`), priced in one Binance
`/api/v3/ticker/price` call, and summed as `amount × price`. Prices are cached 30s keyed on the
symbol set, so a burst of saves — each of which refetches the summary — costs one call, while
buying a new coin still invalidates the cache immediately.

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
- **More than 6 buckets** — the donut caps at 6 slices and folds the rest into one "Khác (n)" slice.
  A 7th generated hue would not be distinguishable from an existing one; the legend still lists
  every bucket individually with its amount.
- **Every balance zero** — the donut renders nothing and shows "Chưa có số dư nào để phân bổ."
- **Negative available** — shown in red rather than clamped. It means more is committed than the
  ledger records (e.g. spot was bought with money never entered), and hiding that would hide a
  bookkeeping error.
- **A deployed bucket was deleted** — it simply drops out of the `deployed[]` list and stops being
  subtracted; the number stays computable.
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
- `apps/web/src/widgets/my-asset/my-asset.tsx` — total tile (+ current value / PnL line), available
  tile + breakdown, ledger table
- `apps/web/src/widgets/my-asset/asset-transaction-dialog.tsx` — Nạp / Rút / Chuyển form
- `apps/web/src/widgets/my-asset/add-category-dialog.tsx` — add a bucket, with label→key slugify
- `apps/web/src/widgets/my-asset/allocation-pie.tsx` — recharts donut + legend; `buildSlices()` does
  the ordering, the negative-balance exclusion and the 6-slice fold
- `apps/web/src/widgets/my-asset/allocation-pie.spec.ts` — 6 cases over `buildSlices()`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav item, placed directly under Overview
- `apps/web/src/shared/api/client.ts` — `fetchAssetSummary`, `createAssetTransaction`,
  `deleteAssetTransaction`, `createAssetCategory`, `updateAssetCategory`, `deleteAssetCategory`,
  and the `assetMutation()` error-surfacing helper
- `apps/web/src/shared/api/types.ts` — `AssetCategory`, `AssetTransaction`, `AssetSummary`,
  `AssetAvailable`, `AssetDeployed`
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
- `apps/api/src/modules/asset/asset.module.ts` — registers `BinanceMarketDataService` for injection
- `apps/api/test/asset.service.spec.ts` — balance derivation, `availableUsdt`, spot
  mark-to-market, realized PnL and every validation rule (32 cases)
- `apps/api/test/stubs/app-db.ts` — in-memory asset ledger used by that spec

**DB**
- `packages/db/prisma/schema.prisma` — `AssetCategory`, `AssetTransaction`
- `packages/db/prisma/migrations/20260805120000_add_asset_tracking/migration.sql` — tables, FKs,
  and the seed for the five default categories
- `packages/db/src/repositories/asset.repository.ts` — `createAssetCategoryRepository`
  (incl. `balanceByKey`, read by /bitget and /mexc for their capital),
  `createAssetTransactionRepository` (incl. `sumBalances`, `sumByType`)
- `packages/db/src/repositories/holding.repository.ts` — `sumTotalCost()` (spot-spend term),
  `sumByCoin()` (per-coin amounts, for market valuation) and `sumRealizedPnl()` (banked profit)
- `apps/api/src/modules/portfolio/portfolio.service.ts` — `getPnlCalendar()`, the /portfolio-pnl
  figure this page's realized term is cross-checked against

**Consumers of this page's data**
- `apps/api/src/modules/bitget/bitget.service.ts` — `capitalUsd()` reads the `bitget` bucket
- `apps/api/src/modules/mexc/mexc.service.ts` — `capitalUsd()` reads the `mexc` bucket

**Worker** — not involved; this feature has no scheduled component.
