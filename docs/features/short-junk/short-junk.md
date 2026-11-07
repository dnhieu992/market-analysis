## Description
`/short-junk` is the hand-kept list of junk coins (CRUD) with the "Short Coin Rác" skill chat in a
floating AI panel (same 🗑️ AI button + slide-in panel as /trading-list). The skill's `scan_junk_shorts` tool and the worker's junk-short Telegram alert scan **only the
coins on this list** — the user decides what is junk; the study's gates (cap before the pump $20–500M,
≥ 50% below ATH, futures listed ≥ 90 days, on Binance spot) no longer drop a listed coin but are returned
as warnings / red flags.

## Main Flow
1. Sidebar → **Short Coin Rác** → `/short-junk` opens on the coin list (old `/skills/short-junk/chat/*`
   links redirect here).
2. Toolbar: **+ Thêm coin** opens a dialog (many coins at once, comma / newline separated, `USDT`
   appended, optional note); **⟳ Sync từ Binance** (`POST /junk-short/coins/sync`) scans every Binance
   USDT-M perp through the study's gates on the last closed D1 (spot + perp, futures ≥ 90 days, cap
   $20–500M, ≥ 50% below ATH) and inserts the coins not listed yet with `source = BINANCE_SYNC`. It never
   removes; synced coins that no longer pass are listed in the result banner with a one-click
   "Xoá các coin này". Search by coin / name.
3. Live stats table (`GET /junk-short/coins/stats`, polled every 30 s while the tab is visible, API caches
   15 s): market cap (circulating supply × price), 24h / 3D / 7D / 30D / 90D change (price now vs the D1
   close N candles back), funding rate + interval (1h / 4h / 8h from `fapi/v1/fundingInfo`, absent = 8h)
   + live countdown to the next funding, ecosystem chips from Binance product tags (Meme, Layer 1/2, DeFi,
   AI, Gaming, RWA, Solana, BNB Chain… — program tags like Seed / Launchpool are dropped), Monitoring /
   no-spot flags, spot listing date (first spot D1 candle, stored once in `spotListedAt`), source. Every
   column sorts (default 24h desc, missing values last); ecosystem chips filter the table. Notes are no
   longer shown or written (the `note` column is left in the DB).
4. The floating **🗑️ AI** button opens the chat panel: one running thread (newest short-junk
   conversation), **Bắt đầu lại** starts a new one.
   The API accepts only coins with a trading Binance USDT-M perpetual and returns the rejected ones.
5. In chat, the model calls `scan_junk_shorts` → the tool reads `junk_short_coins` and calls
   `scanJunkShorts({ symbols })` (@app/core). Setups A/B/WATCH, the ladder plan and the "top gainers"
   table are computed over the list coins only; a candidate failing a study gate carries `warnings[]`.
6. The worker alert (`JunkShortAlertService`, every 15 min) runs the same list-mode scan: setup-A coins and
   list coins ≥ +25%/24h, warnings shown as ⚠️ flags.

## Edge Cases
- Empty list → the tool returns an error asking the model to tell the user to add coins (no fallback to
  the whole market); the worker sends nothing.
- A listed coin later delisted from Binance futures → `universe.notOnBinanceFutures`, the model says it
  cannot be shorted on Binance.
- Sync takes ~7 s (≈ 320 perps scanned, weekly ATH bars cached 24 h); a Binance failure returns 400 and
  nothing is written.
- Stats: D1 closes per coin are cached until the next UTC day (first load ≈ 1 request per coin); a coin
  with < N closed candles shows — for that column; a spot-listing fetch failure retries on the next read.
- Re-adding an existing coin is idempotent; a non-empty note overwrites the old note.
- Fresh listings (< 90 days) stay "Theo dõi" only (prompt rule), other failed gates = half size.

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/junk-short-scan.ts` — `symbols` option (list mode), `warnings`, `universe.source / notOnBinanceFutures / junkTodayCoins`
- `packages/db/prisma/schema.prisma` (`JunkShortCoin`), migrations `20261107150000_junk_short_coins`, `20261107170000_junk_short_coin_source` — table + `source` column
- `packages/db/src/repositories/junk-short-coin.repository.ts` — CRUD repository
- `apps/api/src/modules/junk-short/junk-short-stats.service.ts` — live Binance stats per coin
- `packages/db/prisma/migrations/20261107190000_junk_short_coin_spot_listed_at` — `spotListedAt` column
- `apps/api/src/modules/junk-short/*` — `GET /junk-short/coins/stats`, `GET/POST /junk-short/coins`, `PATCH/DELETE /junk-short/coins/:symbol`
- `apps/api/src/modules/chat/tools/junk-short-scan.tool.ts` — tool scans only the list
- `packages/skills/src/short-junk/*` — prompt / copy: list-only scope, warnings as red flags
- `apps/worker/src/modules/junk-short-alert/junk-short-alert.service.ts` — alert scans only the list
- `apps/web/src/app/short-junk/page.tsx`, `apps/web/src/_pages/short-junk-page/short-junk-page.tsx` — route + server page
- `apps/web/src/widgets/short-junk/short-junk-view.tsx` — page layout
- `apps/web/src/widgets/short-junk/junk-coins-manager.tsx` — toolbar (add dialog, Binance sync, search) + table
- `apps/web/src/widgets/short-junk/short-junk-ai-chat.tsx` — floating AI button + chat panel
- `apps/web/src/_pages/skills-page/skill-chat-page.tsx` — redirects `/skills/short-junk/chat/*` to `/short-junk`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry
