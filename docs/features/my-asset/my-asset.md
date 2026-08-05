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

## Main Flow

1. `GET /asset/summary` (server component, on page load) returns in one round trip:
   - `totalUsdt` — the sum of every category balance,
   - `totalDepositedUsdt` / `totalWithdrawnUsdt` — lifetime totals, summed in SQL,
   - `categories` — each with its derived `balanceUsdt`,
   - `transactions` — the 200 most recent ledger rows.
2. The page renders the total tile with **Nạp / Rút / Chuyển**, a card per category (amount +
   share-of-total bar), and the ledger table.
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
  funded). The share bar clamps to 0–100% so it never renders backwards; the number itself is shown
  as-is rather than hidden.
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
- `apps/web/src/widgets/my-asset/my-asset.tsx` — total tile, category cards, ledger table
- `apps/web/src/widgets/my-asset/asset-transaction-dialog.tsx` — Nạp / Rút / Chuyển form
- `apps/web/src/widgets/my-asset/add-category-dialog.tsx` — add a bucket, with label→key slugify
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav item, placed directly under Overview
- `apps/web/src/shared/api/client.ts` — `fetchAssetSummary`, `createAssetTransaction`,
  `deleteAssetTransaction`, `createAssetCategory`, `updateAssetCategory`, `deleteAssetCategory`,
  and the `assetMutation()` error-surfacing helper
- `apps/web/src/shared/api/types.ts` — `AssetCategory`, `AssetTransaction`, `AssetSummary`
- `apps/web/src/app/globals.css` — `.ma-*` styles

**API (BE)**
- `apps/api/src/modules/asset/asset.controller.ts` — `/asset/summary`, `/asset/transactions`,
  `/asset/categories`
- `apps/api/src/modules/asset/asset.service.ts` — balance derivation and all validation rules
- `apps/api/src/modules/asset/dto/create-asset-transaction.dto.ts`
- `apps/api/src/modules/asset/dto/create-asset-category.dto.ts`
- `apps/api/src/modules/asset/dto/update-asset-category.dto.ts`
- `apps/api/src/app.module.ts` — registers `AssetModule`
- `apps/api/test/asset.service.spec.ts` — balance derivation + every validation rule (17 cases)
- `apps/api/test/stubs/app-db.ts` — in-memory asset ledger used by that spec

**DB**
- `packages/db/prisma/schema.prisma` — `AssetCategory`, `AssetTransaction`
- `packages/db/prisma/migrations/20260805120000_add_asset_tracking/migration.sql` — tables, FKs,
  and the seed for the five default categories
- `packages/db/src/repositories/asset.repository.ts` — `createAssetCategoryRepository`,
  `createAssetTransactionRepository` (incl. `sumBalances`, `sumByType`)

**Worker** — not involved; this feature has no scheduled component.
