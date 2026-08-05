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
available = total − spent buying spot − trading − bitget − mexc
```

`spent buying spot` is the cost basis of coins still held (the sum of `Holding.totalCost` across
portfolios), not the spot bucket's allocation — money sitting unspent in the spot bucket is still
available. The breakdown is rendered line by line beside the number, because an "available" figure
the trader cannot reconcile is one they will not trust.

## Main Flow

1. `GET /asset/summary` (server component, on page load) returns in one round trip:
   - `totalUsdt` — the sum of every category balance,
   - `totalDepositedUsdt` / `totalWithdrawnUsdt` — lifetime totals, summed in SQL,
   - `available` — `availableUsdt` plus the `spentOnSpotUsdt` and `deployed[]` terms it was
     derived from,
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
- **Holdings table unreadable** — `spentOnSpotUsdt` falls back to 0 rather than failing the whole
  summary.
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
- `apps/web/src/widgets/my-asset/my-asset.tsx` — total tile, available tile + breakdown, ledger table
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
- `apps/api/test/asset.service.spec.ts` — balance derivation, `availableUsdt`, and every validation
  rule (22 cases)
- `apps/api/test/stubs/app-db.ts` — in-memory asset ledger used by that spec

**DB**
- `packages/db/prisma/schema.prisma` — `AssetCategory`, `AssetTransaction`
- `packages/db/prisma/migrations/20260805120000_add_asset_tracking/migration.sql` — tables, FKs,
  and the seed for the five default categories
- `packages/db/src/repositories/asset.repository.ts` — `createAssetCategoryRepository`
  (incl. `balanceByKey`, read by /bitget and /mexc for their capital),
  `createAssetTransactionRepository` (incl. `sumBalances`, `sumByType`)
- `packages/db/src/repositories/holding.repository.ts` — `sumTotalCost()`, the spot-spend term

**Consumers of this page's data**
- `apps/api/src/modules/bitget/bitget.service.ts` — `capitalUsd()` reads the `bitget` bucket
- `apps/api/src/modules/mexc/mexc.service.ts` — `capitalUsd()` reads the `mexc` bucket

**Worker** — not involved; this feature has no scheduled component.
