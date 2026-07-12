## Description
The **Pattern Scanner** (`/pattern-scanner`) is a stateless, on-demand tool that scans a
user-managed coin watchlist for classic chart patterns and reports each pattern's key
trading levels. It exists to quickly surface which watched coins are printing an actionable
reversal formation on a chosen timeframe, without persisting any signals.

Detected patterns (pure price action, confirmed fractal pivots only):
- **Hai đáy** (`double_bottom`) — bullish reversal
- **Hai đỉnh** (`double_top`) — bearish reversal
- **Vai đầu vai ngược** (`inverse_head_shoulders`) — bullish reversal
- **Vai đầu vai** (`head_shoulders`) — bearish reversal

Each match reports: `status` (`forming` = neckline not yet broken, `confirmed` = neckline
already broken in the pattern's direction), `neckline` (breakout trigger), measured-move
`target`, structural `stop`, `heightPct` (amplitude as % of base), and `barsAgo` (freshness).

## Main Flow
1. User opens `/pattern-scanner`. The server page (`pattern-scanner-page.tsx`) loads the
   watchlist via `GET /pattern-scanner/coins` and passes it to the client widget.
2. User manages the watchlist — add a coin (`POST /pattern-scanner/coins`, symbol is
   upper-cased and any `USDT` suffix stripped) or remove one (`DELETE /pattern-scanner/coins/:symbol`).
3. User picks which patterns to scan (checkboxes) and a timeframe (`1d`/`4h`/`1w`/`1h`),
   then clicks **Scan** → `POST /pattern-scanner/scan { patterns, timeframe }`.
4. The service fetches up to 300 public Binance klines per watched coin, builds an OHLC
   series, and runs the selected detectors (`scanChartPatterns` in `@app/core`).
5. Results are sorted (confirmed patterns first, then by amplitude) and returned. Coins with
   no match are omitted. The widget renders each matching coin with its pattern rows and levels.

## Edge Cases
- **Too-short series** — coins with fewer than 60 klines are skipped; `scanChartPatterns`
  also returns `[]` when the series is shorter than `wing*2 + minGap + 2`.
- **Fetch failure per coin** — caught per-coin, counted in `failed`, and surfaced in the
  results header; the scan continues for the rest.
- **Stale breakout** — a pattern whose price has already run more than `maxBreakoutPct` (4%)
  past the neckline is rejected as no longer actionable.
- **Invalidated base** — a double/head formation where price has decisively closed beyond the
  base since the completing pivot is skipped.
- **Failed right leg (double top/bottom)** — after the second extreme, if a *confirmed*
  opposite pivot has already formed on the wrong side of the neckline (a lower high below the
  neckline for a double bottom, a higher low above it for a double top), the breakout leg has
  failed and price has rolled over — a topping/bottoming rejection, not a completing pattern —
  so it is rejected. A genuine breakout instead prints its next swing at/beyond the neckline.
- **Non-actionable noise** — patterns require the defining extreme to sit at the local
  extreme of the window, equal lows/highs within `tolPct`, min amplitude `minHeightPct`, and
  (for H&S) shoulder time-symmetry and 15–70% shoulder depth — so mid-range swings don't match.
- **Empty selection / empty watchlist** — the widget blocks the scan and shows an inline error.
- **Remove missing coin** — API throws `NotFoundException`.

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/chart-patterns.ts` — pure pattern detectors (`scanChartPatterns`, config, types)
- `packages/core/src/analysis/chart-patterns.spec.ts` — detector unit tests
- `packages/core/src/index.ts` — exports the detectors/types from `@app/core`
- `packages/db/prisma/schema.prisma` — `PatternWatchCoin` model (`pattern_watch_coins` table)
- `packages/db/prisma/migrations/20260712170000_add_pattern_watch_coins/migration.sql` — table migration
- `packages/db/src/repositories/pattern-scanner.repository.ts` — watchlist CRUD
- `packages/db/src/index.ts` — exports `createPatternScannerRepository`
- `apps/api/src/modules/pattern-scanner/pattern-scanner.controller.ts` — REST endpoints
- `apps/api/src/modules/pattern-scanner/pattern-scanner.service.ts` — fetch klines + run detectors
- `apps/api/src/modules/pattern-scanner/dto/add-coin.dto.ts`, `dto/scan.dto.ts` — request validation
- `apps/api/src/modules/pattern-scanner/pattern-scanner.module.ts` — module wiring
- `apps/api/src/app.module.ts` — registers `PatternScannerModule`
- `apps/web/src/app/pattern-scanner/page.tsx` — App Router route (thin re-export)
- `apps/web/src/_pages/pattern-scanner-page/pattern-scanner-page.tsx` — server page, loads watchlist
- `apps/web/src/widgets/pattern-scanner/pattern-scanner-feed.tsx` — client UI (watchlist, controls, results)
- `apps/web/src/shared/api/client.ts` — `fetchPatternCoins`, `addPatternCoin`, `removePatternCoin`, `scanPatterns`
- `apps/web/src/shared/api/types.ts` — `PatternKind`, `PatternWatchCoin`, `PatternMatch`, `PatternScanResult`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — sidebar nav entry
- `apps/web/src/app/globals.css` — `.ps-*` styles
