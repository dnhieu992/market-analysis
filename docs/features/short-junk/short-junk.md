## Description
`/short-junk` is the hand-kept list of junk coins (CRUD) with the "Short Coin Rác" skill chat in a
floating AI panel (same 🗑️ AI button + slide-in panel as /trading-list). The skill's `scan_junk_shorts` tool and the worker's junk-short Telegram alert scan **only the
coins on this list** — the user decides what is junk; the study's gates (cap before the pump $20–500M,
≥ 50% below ATH, futures listed ≥ 90 days, on Binance spot) no longer drop a listed coin but are returned
as warnings / red flags.

## Main Flow
1. Sidebar → **Short Coin Rác** → `/short-junk` opens on the coin list (old `/skills/short-junk/chat/*`
   links redirect here).
2. **Thêm coin**: add many coins at once (comma / newline separated, `USDT` appended, optional note);
   in the table click a note to edit it, **Xoá** to remove, search by coin / note.
3. The floating **🗑️ AI** button opens the chat panel: one running thread (newest short-junk
   conversation), **Bắt đầu lại** starts a new one.
   The API accepts only coins with a trading Binance USDT-M perpetual and returns the rejected ones.
4. In chat, the model calls `scan_junk_shorts` → the tool reads `junk_short_coins` and calls
   `scanJunkShorts({ symbols })` (@app/core). Setups A/B/WATCH, the ladder plan and the "top gainers"
   table are computed over the list coins only; a candidate failing a study gate carries `warnings[]`.
5. The worker alert (`JunkShortAlertService`, every 15 min) runs the same list-mode scan: setup-A coins and
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
- `apps/web/src/app/short-junk/page.tsx`, `apps/web/src/_pages/short-junk-page/short-junk-page.tsx` — route + server page
- `apps/web/src/widgets/short-junk/short-junk-view.tsx` — page layout
- `apps/web/src/widgets/short-junk/junk-coins-manager.tsx` — add / edit note / delete table
- `apps/web/src/widgets/short-junk/short-junk-ai-chat.tsx` — floating AI button + chat panel
- `apps/web/src/_pages/skills-page/skill-chat-page.tsx` — redirects `/skills/short-junk/chat/*` to `/short-junk`
- `apps/web/src/widgets/app-shell/sidebar-nav.tsx` — nav entry
