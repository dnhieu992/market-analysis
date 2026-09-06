## Description
A shared in-memory cache of Binance daily candles behind `/tracking-coins`, so the
page stops re-fetching the same klines on every load.

`/tracking-coins/price-changes` (7d/30d/90d/180d columns) and `/tracking-coins/scores`
(Supertrend D1 rule) both need 1d candles for the same ~37 tracked coins. Each used to
keep its own 5-minute cache and fetch symbols **one at a time**, so a cold load cost 74
sequential Binance round trips — measured at 5-13s per endpoint in the API logs.

`DailyCandleCacheService` fetches each symbol once, concurrently, and serves both
endpoints from the same entry.

## Main Flow
1. The page's server component loads `GET /tracking-coins` (DB only, ~60ms) and renders.
2. The client then requests `/tracking-coins/price-changes` and `/tracking-coins/scores`
   for the visible symbols.
3. Both controllers call their service, which calls `DailyCandleCacheService.getMany()`
   with the bare symbols.
4. For each symbol the cache decides:
   - **fresh** (< 5 min) → returned from memory, no network;
   - **stale** (< 6 h) → the stale copy is returned *immediately* and a refresh is kicked
     off in the background (stale-while-revalidate);
   - **missing / older than 6 h** → the caller waits for a fetch.
5. Symbols that must be fetched run through a pool of 8 concurrent requests.
6. `TrackingCoinScoreService` drops the in-progress candle and evaluates the rules;
   `TrackingCoinsService` reads closes at offsets 7/30/90/180 from the end.
7. Both responses carry `Cache-Control: private, max-age=60`, so a reload within a minute
   is served by the browser without touching the API.

## Edge Cases
- **Two endpoints, one symbol, same moment** — `inFlight` dedupes by symbol, so the second
  caller awaits the first request instead of firing its own.
- **Binance fetch fails** — the previous cached candles are reused (a column keeps its last
  known value); with nothing cached the symbol maps to `null`, which becomes a blank score
  (`score: null`) or blank change cells, never a 500.
- **Cold start after `pm2 restart`** — the cache is memory-only, so the first load after a
  restart still pays the fetch, now parallel (~1s instead of 5-13s). Every later load is
  served from memory.
- **Coin added to the list** — its symbol is not cached, so it falls into the blocking
  fetch path on the next request while the others are served from memory.
- **New listing with < 60 closed daily candles** — the Supertrend rule returns `null`
  (unchanged behaviour, `MIN_CLOSED_CANDLES` gate).
- **Newly deleted coin** — the query string changes, so the browser cache entry for the old
  URL is never reused.
- Cache is per API process; there is a single `market-api` process, so no cross-process skew.

## Related Files (FE / BE / Worker)
- `apps/api/src/modules/market/daily-candle-cache.service.ts` — the shared cache: TTL,
  stale-while-revalidate, in-flight dedupe, concurrency pool
- `apps/api/src/modules/market/market.module.ts` — provides/exports `DailyCandleCacheService`
- `apps/api/src/modules/tracking-coins/tracking-coins.service.ts` — `getPriceChanges()` now
  reads the shared cache instead of fetching klines itself
- `apps/api/src/modules/tracking-coins/tracking-coin-score.service.ts` — `getScores()` now
  reads the shared cache; its own per-symbol cache was removed
- `apps/api/src/modules/tracking-coins/tracking-coins.controller.ts` — `Cache-Control` headers
  on `price-changes` and `scores`
- `apps/web/src/widgets/tracking-coins/tracking-coins-feed.tsx` — the client that calls both
  endpoints after mount
