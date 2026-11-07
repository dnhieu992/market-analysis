## Description
`/short-junk` is the "Short Coin Rác" skill chat on its own page, plus a hand-kept list of junk coins
(CRUD). The skill's `scan_junk_shorts` tool and the worker's junk-short Telegram alert scan **only the
coins on this list** — the user decides what is junk; the study's gates (cap before the pump $20–500M,
≥ 50% below ATH, futures listed ≥ 90 days, on Binance spot) no longer drop a listed coin but are returned
as warnings / red flags.

## Main Flow
1. Sidebar → **Short Coin Rác** → `/short-junk` → redirects to `/short-junk/chat/new` (old
   `/skills/short-junk/chat/*` links redirect here too).
2. Header button **🗑️ Coin rác (N)** opens the list dialog: add many coins at once (comma / newline
   separated, `USDT` appended, optional note), click a note to edit it, **Xoá** to remove.
   The API accepts only coins with a trading Binance USDT-M perpetual and returns the rejected ones.
3. In chat, the model calls `scan_junk_shorts` → the tool reads `junk_short_coins` and calls
   `scanJunkShorts({ symbols })` (@app/core). Setups A/B/WATCH, the ladder plan and the "top gainers"
   table are computed over the list coins only; a candidate failing a study gate carries `warnings[]`.
4. The worker alert (`JunkShortAlertService`, every 15 min) runs the same list-mode scan: setup-A coins and
   list coins ≥ +25%/24h, warnings shown as ⚠️ flags.

## Edge Cases
- Empty list → the tool returns an error asking the model to tell the user to add coins (no fallback to
  the whole market); the worker sends nothing.
- A listed coin later delisted from Binance futures → `universe.notOnBinanceFutures`, the model says it
  cannot be shorted on Binance.
- Re-adding an existing coin is idempotent; a non-empty note overwrites the old note.
- Fresh listings (< 90 days) stay "Theo dõi" only (prompt rule), other failed gates = half size.

## Related Files (FE / BE / Worker)
- `packages/core/src/analysis/junk-short-scan.ts` — `symbols` option (list mode), `warnings`, `universe.source / notOnBinanceFutures`
- `packages/db/prisma/schema.prisma` (`JunkShortCoin`), `packages/db/prisma/migrations/20261107150000_junk_short_coins/` — table
- `packages/db/src/repositories/junk-short-coin.repository.ts` — CRUD repository
- `apps/api/src/modules/junk-short/*` — `GET/POST /junk-short/coins`, `PATCH/DELETE /junk-short/coins/:symbol`
- `apps/api/src/modules/chat/tools/junk-short-scan.tool.ts` — tool scans only the list
- `packages/skills/src/short-junk/*` — prompt / copy: list-only scope, warnings as red flags
- `apps/worker/src/modules/junk-short-alert/junk-short-alert.service.ts` — alert scans only the list
- `apps/web/src/app/short-junk/**`, `apps/web/src/_pages/short-junk-page/short-junk-page.tsx` — routes + page
- `apps/web/src/widgets/short-junk/junk-coins-dialog.tsx` — header button + CRUD dialog
- `apps/web/src/_pages/skills-page/skill-chat-client.tsx` — `basePath` / `backLink` / `headerExtra` props for skill pages
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry
