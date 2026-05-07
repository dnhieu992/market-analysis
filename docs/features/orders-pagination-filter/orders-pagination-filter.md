## Description
Server-side filtering and offset-based pagination for the orders API. Removes the hardcoded 50-order limit. All filtering (symbol, status, broker, date range) is performed by the database. Filter state lives in URL search params so the Next.js server component re-fetches on each navigation.

## Main Flow
1. User visits `/trades` (optionally with query params: `?symbol=BTC&status=open&page=2`)
2. `TradesPage` (Server Component) reads `searchParams` prop and calls `fetchOrders(params)` + `fetchOrderBrokers()` in parallel
3. API `GET /orders` receives query params, validates via `ListOrdersQueryDto`, passes to `OrdersService.listOrders()`
4. Service splits `broker` CSV into string array, converts `dateFrom`/`dateTo` strings to `Date`, calls `OrderRepository.listFiltered()`
5. Repository runs 4 queries in parallel via `Promise.all`: paginated `findMany`, `count`, `aggregate._sum.pnl` for closed orders, and `findMany` for all matching open orders (skipped if `status=closed`)
6. Response: `{ data, total, page, pageSize, closedPnlSum, openOrders }` returned to frontend
7. `TradesHistory` → `TradesTable` renders table rows, PnL cards, and Pagination component
8. Filter changes (symbol debounced 400ms, others immediate) call `router.push()` with updated URL params → RSC re-render

## Edge Cases
- `dateFrom > dateTo`: BE returns empty result (no error thrown)
- `page` out of range: BE returns empty `data[]` with `total` unchanged; FE Pagination prevents navigating past last page
- `broker` CSV with unknown values: Prisma `IN` clause simply yields no results
- `closedPnlSum` when no closed orders match: returns `0`
- `openOrders` when `status=closed` filter active: BE skips the open orders query, returns `[]`
- Symbol filter debounced 400ms to avoid excessive URL navigations while typing
- All API/fetch errors in `TradesPage` fall back to safe empty defaults: `{ data: [], total: 0, page: 1, pageSize: 20, closedPnlSum: 0, openOrders: [], availableBrokers: [] }`

## Related Files (FE / BE / Worker)
- `packages/db/src/repositories/order.repository.ts` — `listFiltered()` and `listDistinctBrokers()` methods; 4 parallel DB queries
- `packages/db/src/repositories/order.repository.spec.ts` — repository unit tests
- `apps/api/src/modules/orders/dto/list-orders-query.dto.ts` — `ListOrdersQueryDto` with validation
- `apps/api/src/modules/orders/orders.service.ts` — `listOrders()` and `listBrokers()` methods
- `apps/api/src/modules/orders/orders.controller.ts` — `GET /orders` (paginated), `GET /orders/brokers`
- `apps/web/src/shared/api/types.ts` — `OrderFilterParams`, `PaginatedOrders` types
- `apps/web/src/shared/api/client.ts` — `fetchOrders()`, `fetchOrderBrokers()` API client methods
- `apps/web/src/app/trades/page.tsx` — passes `searchParams` to server component
- `apps/web/src/_pages/trades-page/trades-page.tsx` — Server Component: reads params, parallel fetch, Suspense boundary
- `apps/web/src/widgets/trades-history/trades-history.tsx` — passes pagination/filter props to TradesTable
- `apps/web/src/widgets/trades-history/trades-table.tsx` — URL-based filter state, Pagination component, `calcUnrealizedPnl`, `getPageNumbers`
- `apps/web/src/widgets/trades-history/trades-table.spec.ts` — unit tests for `calcUnrealizedPnl` and `getPageNumbers`
