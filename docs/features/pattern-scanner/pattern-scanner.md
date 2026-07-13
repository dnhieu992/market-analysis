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
   no match are omitted. Each matching coin result also carries the full OHLC series used for
   the scan (`opens`/`highs`/`lows`/`closes`, 300 points, oldest → newest) so the UI can draw
   the pattern. The widget renders each matching coin with its pattern rows and levels.
6. **Pattern chart (FE).** For every match the widget draws an inline SVG **candlestick** chart
   (`PatternChart` in `pattern-scanner-feed.tsx`) in the same green/red style as the Daily Plan
   chart (`#26a69a` up / `#ef5350` down, matching worker `chart-renderer.ts`): OHLC windowed
   from ~6 bars before the first pivot through the latest candle, with the defining pivots marked
   and labelled (VT/Đầu/VP for H&S, Đ1/Đ2 for double top/bottom) and the neckline (NL), target
   (TP) and stop (SL) drawn as reference lines (the NL/TP/SL text labels are nudged apart so
   close levels don't overprint). Rendered purely client-side from the returned OHLC — no image
   request, no server render, no new dependency.
7. **Fullscreen (FE).** Clicking the chart opens a full-screen lightbox (`ChartZoom`) rendering
   the same chart at `variant="full"` (wider viewBox + larger fonts); closes on backdrop click or
   Esc. It is rendered through a **portal to `document.body`** so a card ancestor's `backdrop-filter`
   can't trap the fixed overlay inside the content column — the overlay covers the whole viewport
   (`.ps-chart-zoom` is `100vw × 100dvh`).

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
- **Wide double base mistaken for H&S** — an inverse/normal H&S is rejected when the head is
  **not an isolated extreme**: if any other same-kind pivot between the two shoulders sits within
  `tolPct` (3%) of the head price, the "head" is really one half of a wide double bottom/top and
  the middle-pivot choice is arbitrary. (Caught a false BTC H4 IH&S in 2026-07 whose head at
  57,800 had a rival low at 58,115 — 0.5% away — 33 bars earlier.)
- **Empty selection / empty watchlist** — the widget blocks the scan and shows an inline error.
- **Remove missing coin** — API throws `NotFoundException`.

### Pattern rule info dialog (FE)
Each pattern has an info icon (ⓘ) — both next to its checkbox in the "Pattern cần quét"
selector and next to its name in each result row. Clicking opens a dialog (reuses the app's
`.dialog-*` modal, closes on backdrop click or Esc) with two tabs:

- **Quy tắc** — describes the pattern shape and the exact detection criteria. Content lives in
  `PATTERN_RULES` in `pattern-scanner-feed.tsx` and is kept faithful to the detector in
  `chart-patterns.ts` (fractal wing 5, 3% equality tolerance, ≥5% amplitude, 10–60 bar gap,
  25-bar recency, failed right-leg rejection, H&S head-isolation gate, 4% stale-breakout cutoff).
  Update `PATTERN_RULES` whenever the detector thresholds change.

- **Ảnh thực tế** — a reference image gallery for the pattern. The user pastes an image URL
  (TradingView screenshot, imgur, etc.) with optional notes; images are stored in the
  `pattern_reference_images` DB table. Images load lazily when the tab is first opened.
  Clicking a thumbnail opens a full-screen lightbox (Esc closes). Each image has a delete button.

### Pattern reference images (BE)
- `GET /pattern-scanner/references/:pattern` — list images for a pattern (newest first)
- `POST /pattern-scanner/references` — add `{ pattern, imageUrl, notes? }`
- `DELETE /pattern-scanner/references/:id` — remove a reference image

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/chart-patterns.ts` — pure pattern detectors (`scanChartPatterns`, config, types)
- `packages/core/src/analysis/chart-patterns.spec.ts` — detector unit tests
- `packages/core/src/index.ts` — exports the detectors/types from `@app/core`
- `packages/db/prisma/schema.prisma` — `PatternWatchCoin` + `PatternReferenceImage` models
- `packages/db/prisma/migrations/20260712170000_add_pattern_watch_coins/migration.sql` — watchlist table
- `packages/db/prisma/migrations/20260713100000_add_pattern_reference_images/migration.sql` — reference images table
- `packages/db/src/repositories/pattern-scanner.repository.ts` — watchlist + reference image CRUD
- `packages/db/src/index.ts` — exports `createPatternScannerRepository`
- `apps/api/src/modules/pattern-scanner/pattern-scanner.controller.ts` — REST endpoints
- `apps/api/src/modules/pattern-scanner/pattern-scanner.service.ts` — fetch klines + run detectors; returns `closes` per matching coin
- `apps/web/src/widgets/pattern-scanner/pattern-scanner-feed.tsx` — `PatternChart` SVG (pivots + NL/TP/SL levels) drawn from `closes`
- `apps/api/src/modules/pattern-scanner/dto/add-coin.dto.ts`, `dto/scan.dto.ts`, `dto/add-reference.dto.ts` — request validation
- `apps/api/src/modules/pattern-scanner/pattern-scanner.module.ts` — module wiring
- `apps/api/src/app.module.ts` — registers `PatternScannerModule`
- `apps/web/src/app/pattern-scanner/page.tsx` — App Router route (thin re-export)
- `apps/web/src/_pages/pattern-scanner-page/pattern-scanner-page.tsx` — server page, loads watchlist
- `apps/web/src/widgets/pattern-scanner/pattern-scanner-feed.tsx` — client UI (watchlist, controls, results)
- `apps/web/src/shared/api/client.ts` — `fetchPatternCoins`, `addPatternCoin`, `removePatternCoin`, `scanPatterns`, `fetchPatternReferences`, `addPatternReference`, `removePatternReference`
- `apps/web/src/shared/api/types.ts` — `PatternKind`, `PatternWatchCoin`, `PatternMatch`, `PatternScanResult`, `PatternReferenceImage`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — sidebar nav entry
- `apps/web/src/app/globals.css` — `.ps-*` styles
