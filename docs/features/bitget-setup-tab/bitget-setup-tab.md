## Description
Adds a **Setup** tab to the Bitget dashboard (`/bitget`). It lists **BTC and ETH pinned first**,
then a fixed **watchlist** (SOL, XRP, SHIB, PEPE, WLD, BCH, AVAX, AAVE, FIL, ONDO, TIA), then
every other coin that has ever been traded (unique symbols pulled from the History tab, newest
closed first) — deduplicated so a coin only ever appears once, in that priority order. Each row
gets a separate **Long** and **Short** action cell, plus **one ⚙ button per row** (next to the
coin name in the Symbol cell). That single ⚙ opens the coin's whole config in one dialog —
**LONG and SHORT side by side** (leverage, margin — margin mode is always **cross**, order type
is always **market**) **and the “Auto vào lệnh” switch** (see
[`bitget-auto-trade`](../bitget-auto-trade/bitget-auto-trade.md)). It replaced the two separate
per-side ⚙ buttons on 2026-07-30: auto-entry is a **per-coin** setting, so a per-side dialog had
nowhere to put it. Each side keeps its own **Long / Short** open button that places a live market
order on Bitget using that side's config. The buttons stay **always enabled**: when that exact
coin **+ side** already has an open position, the button reads **“+ Long” / “+ Short”** (dashed
border) and clicking it **adds volume to the existing position** (scale-in) instead of opening a
second one — the add-on is written to the trade's journal as a read-only **system log**.
Per-side config is
persisted in the **database** (`bitget_setup_configs`, unique on `symbol + holdSide`) so it
survives reloads and is shared across devices.

A **⚙ Setup nhiều coin** button in the table toolbar opens a **bulk config dialog**. It has
**two independent side blocks** — **LONG** (green) and **SHORT** (red) — each with its own
checkbox to enable it plus its **own leverage and margin**, so one save can configure long and
short at different sizes (or only one of them). Below them is the coin picker: a searchable
checkbox grid with "Chọn tất cả" / "Bỏ chọn"; coins that already have a config for an enabled
side are marked with an orange ●. Saving **overwrites** the config of every selected
`coin × enabled side` pair in a single transaction — a side whose checkbox is **off** is left
untouched. The dialog states how many configs will be written, with which values per side, and
how many of those are overwrites before the save.

Each coin's **realtime price** and **change
since 00:00 UTC** (the **"Hôm nay"** column, streamed from Bitget's public WebSocket ticker)
show once per row, alongside **"7 ngày"**, **"30 ngày"** and **"H4"** columns. The 7-day and
30-day price change is computed server-side from Binance daily candles (current close vs the
close 7 / 30 candles back); **H4** (the last column before QQE) is the **previous CLOSED 4h
candle's own move**, `(close − open) / open`, from Binance 4h candles — the still-forming
candle is deliberately skipped so the number never repaints. All three come from
`GET /bitget/price-changes?symbols=…`, fetched on mount and every 5 min.
The **"Hôm nay"**, **"7 ngày"**, **"30 ngày"** and **"H4"** headers are each a **sort toggle**: rows keep
the default **star-priority** order until a header is clicked, then clicking that header cycles
**descending → ascending → back to that default** (coins with no reading always sink to the
bottom). Only one column sorts at a time — clicking a different header starts fresh at
descending.

Each coin row opens its chart from a **candlestick icon button right next to the coin name**
(shared `ChartIcon`, identical to the Positions and History tabs — it replaced the old
"📈 Chart" text button under the name on 2026-07-27). It opens a fullscreen dialog with a
server-rendered PNG chart. The dialog has an **M15 / M30 / H1 / H4 / D1** timeframe switcher in
its header (defaults to **H4**) that re-fetches the render in place — one button per row instead
of five. The chart carries TradingView-default indicators: the **SonicR system** (EMA34
of high/low/close as the green "Dragon" ribbon + EMA89 trend line), **UT Bot Alerts (ATR 10,
key value 3)** — the ATR trailing stop drawn as a stepped line, **green while price holds above
it, red once price flips below**, with a dot on the line at each flip bar, **Support/Resistance
Channels** (LonesomeTheBlue-style pivot channels), **RSI(14)**, a **FxCanli Volume (Hacim)**
pane (per-bar volume histogram coloured by candle direction + MA20), **colinmck "QQE
Signals" (14,5,4.238)** markers drawn on the price candles — a green ▲ **Long** below the candle
where the QQE trailing line crosses under RSI-MA, a red ▼ **Short** above where it crosses over —
and an **Engulfing Candles Detector** (TradingView default: 1 engulfed candle, body-based):
every bullish/bearish engulfing candle is **coloured solid (green bull / red bear), overriding
the candle's normal style** — no box or text label, the colour alone flags the pattern. Normal
candles are drawn **monochrome** (white body up / black body down, black borders + wicks) so the
coloured engulfing candles + indicators stand out.
The dialog has a **💾 Lưu** button (same action as the History tab). Clicking it opens a small
**note dialog** (`ChartNoteDialog`) where the trader can attach an optional note (may be blank),
written in the **shared `MarkdownEditor`** (TipTap, lazy-loaded) with an **✨ Định dạng bằng AI**
button that reformats the draft into clean Markdown via the stateless LLM endpoint
(`POST /chat`, `reformatChartNote`). On confirm it snapshots the current Setup chart to R2 via
`POST /bitget/setup-chart/save` (body `{ symbol, timeframe, note? }`) and stores a DB link so it
appears in the coin's **🖼 Reference** gallery. Each save is a fresh reference image (timestamped
synthetic `tradeKey` `setup-<coin>-<tf>-<ms>`), unlike a trade chart which upserts on a stable
`tradeKey`. The note is stored in `bitget_trade_charts.note` (nullable) and shown in the gallery
via the shared `ChartNoteView` (`renderMarkdown` → HTML): a 📝 badge on thumbnails that have one,
and the rendered Markdown under the enlarged image's caption.

The chart also overlays **position markers**: every live open position for the coin draws a
solid entry line (green LONG / red SHORT) tagged with entry price + live uPnL, and the most
recent **closed** trade that closed **within the last 30 minutes** draws a grey dashed entry
line plus a win/loss-coloured dashed close line tagged with realized PnL ("lãi"/"lỗ") — once a
trade has been shut longer than 30 minutes its markers drop off. Markers are looked up
server-side from live positions + closed history; the lookup is non-fatal. An **EMA200** (orange)
trend line is drawn alongside the SonicR EMAs on every chart (all tabs); the candle-fetch counts
are sized to keep it warm across the displayed window (`limit ≥ display + 200`, and the trade
review chart's lookback is 210 bars).

Each coin row also carries an **Attachments** cell at the end of the row (previously labelled
"Tham chiếu"): an **🖼 image icon plus the number of saved charts** that reference this coin.
The counts come from one grouped query, `GET /bitget/trade-chart/counts`, fetched on mount and
re-fetched whenever the chart dialog closes (a snapshot may have just been saved). A coin with
**0** images is dimmed but still clickable. Clicking it opens the same
fullscreen **chart gallery** as before, laid out like an e-commerce product-image viewer: a
rail of clickable thumbnails on the left (one per saved snapshot, tagged with its timeframe) and
a large main image on the right with a caption (timeframe + saved-at time). The images are the
**saved** trade-chart PNGs on public R2 (saved from the History tab's 💾 Lưu action), listed by
coin via `GET /bitget/trade-chart/by-symbol?symbol=…`. Clicking the main image opens the original
PNG in a new tab.

The trader can rank coins by hand with a **0–5 star** rating shown **under the coin name** in
the Symbol cell — there is **no separate Priority column** (it was tried and removed on
2026-07-27; the stars live with the coin instead). All five stars render on every row: the ones
up to the coin's rating are **yellow**, the rest stay **grey**, so an unrated coin shows five
grey stars. Clicking star *n* sets the rating to *n*; clicking the star that is **already** the
current rating clears it back to **0** (otherwise 1 star would be a floor). Hovering previews
the rating. Ratings are stored per coin — not per side — in the DB (`bitget_symbol_priorities`,
unique on `symbol`) via `PUT /bitget/setup/priority`, so they persist across reloads and
devices. The tab **opens sorted by star priority descending** (highest stars on top). Because
the stars have no header of their own to click, the change columns' "off" step returns to this
star order instead of the raw pinned order — so the default is always one click away. Coins
with equal ratings keep the pinned/watchlist order (the sort is stable).

## Main Flow
1. User opens `/bitget` → clicks the **Setup** tab (or lands via `?tab=setup`).
2. The feed builds the symbol list as `PINNED_SYMBOLS` (BTC, ETH) + `WATCHLIST_SYMBOLS` (fixed
   list, see Description) + every unique symbol from `history.trades` (newest-closed first),
   deduped, and renders one row per coin, each with a **Long** and a **Short** action cell (config
   summary + open button) and a single row-level **⚙** in the Symbol cell.
   It hydrates saved configs once via `GET /bitget/setup`, the auto-entry switches via
   `GET /bitget/auto-trade` (an **AUTO** badge shows next to the coin name when armed),
   fetches live positions every 15s to know which coin+sides are currently open, and subscribes
   to the Bitget public WS `ticker` channel for every listed symbol to show live price + change
   since 00:00 UTC (green/red). A "Realtime / Đang kết nối…" pill reflects the WS state. It also
   fetches the **QQE** column data via `GET /bitget/qqe-signals?symbols=…` on mount and every 60s.
   On mount it also hydrates the star priorities (`GET /bitget/setup/priority`) and the
   attachment counts (`GET /bitget/trade-chart/counts`), then renders the rows **sorted by
   star priority descending**. Each Symbol cell stacks the coin name + chart icon on the first
   line and that coin's stars underneath. It reports its unfiltered coin count up to
   `BitgetTabs` via `onCount`, which shows it as **Setup (N)** on the tab label — the toolbar's
   own "N coin" counter was removed on 2026-07-27 as a duplicate of that label.
2c. User clicks a star under a coin name → the row re-sorts immediately (optimistic)
   and `PUT /bitget/setup/priority` (`{ symbol, priority }`) persists it. A failed write rolls
   the rating back to its previous value and shows a red alert, so the visible order always
   matches what is in the DB.
2b. Each row's **QQE** column shows only the chart-view timeframes (**M30 / H1 / H4 / D1**) that
   currently carry a **live** colinmck "QQE Signals" signal — i.e. the QQE line flipped within the
   **last 5 closed candles** (`QQE_SIGNAL_VALID_BARS`); older flips are treated as stale and hidden.
   Each shown timeframe is rendered as its label coloured **green for Long / red for Short** (no L/S
   mark); hover shows how many candles ago it fired. A coin with no live signal shows a muted "—".
   Readings come from the last closed candle (no repaint), computed server-side from public Binance
   klines with `calculateQqe` and cached ~60s per (coin, tf); the 5-candle validity filter is applied
   client-side so the window is easy to tune.
3. User clicks the row's **⚙** (Symbol cell) → `CoinSetupDialog` (portaled to `document.body`)
   opens with three blocks: **LONG** and **SHORT** (leverage 1–125×, margin in USDT; margin mode /
   order type fixed to **Market · Cross**) and **Auto vào lệnh**. Saving writes only the sides
   whose numbers actually changed via `PUT /bitget/setup` (upsert on `symbol + holdSide`), **then**
   the auto switch via `PUT /bitget/auto-trade` — in that order, because arming auto is rejected
   server-side without a saved LONG margin. A side whose margin field is left **empty** is not
   written at all, so "chưa cấu hình" keeps its meaning.
3b. **Bulk setup:** User clicks **⚙ Setup nhiều coin** → dialog opens pre-ticked with the
   toolbar's current coin filter (empty filter = nothing pre-ticked). Filling the enabled side
   blocks + picking coins and saving calls `PUT /bitget/setup/bulk`
   (`saveBitgetSetupConfigsBulk({ symbols, sides: [{ holdSide, leverage, marginUsd }, …] })`).
   `BitgetSetupService.upsertMany()` validates each side's leverage/margin, de-duplicates symbols
   and sides (last entry per side wins), expands them into the `symbols × sides` product and writes them through
   `bitgetSetupConfigRepository.upsertMany()` — one Prisma `$transaction`, so a partial write
   can never leave half the batch applied. The saved rows come back and are merged into the
   tab's config map (no optimistic guess).
4. User clicks **Long** / **Short** (or **+ Long** / **+ Short** on an open side) → confirm
   dialog — its text spells out whether this OPENS a position or ADDS volume to the open one →
   `POST /bitget/positions/open` via `openBitgetPosition()`. The API:
   - reads the live position for that symbol+side (`single-position`) to decide `mode`:
     `'new'` when flat, `'add'` when already open;
   - reads the live ticker price + contract precision;
   - computes size = `margin × leverage ÷ price`, floored to the contract's `volumePlace`
     (rejected 400 if below `minTradeNum`). When adding, `leverage` is the **live position's**
     leverage, not the configured one — Bitget refuses leverage changes on an open position;
   - sets cross leverage **only when flat** (passing `holdSide` in hedge mode — see edge
     cases), then places a **market** order (`marginMode: crossed`, no preset TP/SL — a
     deliberate manual entry);
   - when adding: writes a `system` note to the trade's journal (tradeKey
     `symbol-holdSide-openedAt`) recording added size, margin/leverage, market price and
     `size trước → sau`, plus a `Logger.log` line in the API process log.
5. On success a green notice shows the filled size/price (and, for an add-on, the new total
   size + leverage and a reminder that it was logged) and positions refresh.

**Đánh giá (per-coin assessment)**
1. Each row carries an **Đánh giá** cell between QQE and the Long/Short buttons: a one-line
   preview of the saved note, or a dashed **+ Đánh giá** placeholder when there is none. The
   full text is on the button's tooltip.
2. Clicking opens `SymbolNoteDialog` — the shared TipTap `MarkdownEditor`, plus a **Xem trước**
   toggle that renders the Markdown, and the last-updated timestamp.
3. **Lưu đánh giá** → `PUT /bitget/setup/note` upserts `bitget_symbol_notes` keyed by symbol.
   Saving blank text deletes the row. The tab hydrates every note once on mount via
   `GET /bitget/setup/note`.

## Edge Cases
- **Đánh giá rỗng = xoá:** saving a blank assessment deletes the row instead of storing an empty
  string, so "has a note" stays a plain row-exists check and the cell falls back to the dashed
  **+ Đánh giá** placeholder. The Lưu button is disabled until the text actually changes.
- **Đánh giá quá dài:** capped at 20 000 characters server-side (guards against pasting a whole
  document) — over the limit the API returns 400 and the dialog shows the message inline.
- **Đánh giá vs coin list:** the note is keyed by symbol alone, not by trade — it survives after
  every position on that coin is closed, which is the point (it is the running view on the coin).
- **UT Bot warm-up / young coin:** the trailing stop is computed over the *full* fetched history
  (not just the displayed window) so it is already warm at the left edge. Bars where ATR(10) has
  no value yet yield `stopLevel = 0`, which is mapped to `NaN` and simply not drawn — the line
  starts a little later on a coin with very few candles instead of collapsing to zero.
- **UT Bot after a sharp flip:** the stop can sit far outside the candle range, so its values are
  folded into the y-axis min/max — the line stays inside the pane rather than being clipped away.
- **Already open (per side):** the button stays enabled and switches to **+ Long / + Short**;
  clicking scales into that position. The confirm dialog says so explicitly, so an accidental
  double-click can't quietly double the position. A stale UI is harmless: the API re-reads the
  live position and decides `new` vs `add` server-side, never from the client's guess.
- **Add-on leverage:** the configured leverage is ignored when adding — the position's own
  leverage is used for sizing and returned in the response (shown in the notice), because
  Bitget rejects `set-leverage` while a position is open.
- **Not configured:** clicking Open with margin ≤ 0 shows a red hint instead of firing an
  order (the button itself is no longer disabled).
- **Bulk save is destructive by design:** it replaces the leverage/margin of every selected
  `coin × side`. The dialog shows the ● marker per already-configured coin and an explicit
  "N cấu hình đã có sẽ bị ghi đè" line; Save is disabled until at least one coin, one side and
  a valid leverage/margin are set.
- **Bulk save with no coin / no side selected** → Save stays disabled client-side; the API also
  rejects an empty `symbols`/`sides` array with 400 (Vietnamese message).
- **A side is enabled but half-filled** (blank margin, leverage out of 1–125) → Save is blocked
  with an inline red hint naming the fix, so a typo can't silently drop that side from the batch.
- **Duplicate symbols in the bulk payload** → collapsed server-side (`new Set`) so the same
  row can't be upserted twice inside one transaction.
- **Bulk save fails** → red alert, dialog stays open with the selection intact, and no config
  is changed (transaction rolls back).
- **Margin too small:** size floors below the contract minimum → API returns 400 with a
  Vietnamese message asking to raise margin/leverage.
- **Bitget not configured:** if credentials are missing the tab shows the same setup notice
  as the other tabs.
- **Config fetch/save fails:** hydration failure is non-fatal (rows show unconfigured);
  a save failure surfaces a red alert and the optimistic row state is kept.
- **Concurrent opens:** the Open buttons are disabled globally while any open is in flight
  (`openingKey !== null`).
- **Narrow / mobile chart dialog header:** the header row wraps instead of overflowing —
  the title truncates with an ellipsis and the ✕ close button is `flex: 0 0 auto` with an
  explicit `order`, so it can never be pushed out of the (`overflow: hidden`) dialog. Under
  640px the `· SonicR + S/R Channel + RSI` subtitle is hidden and the timeframe tabs drop to
  their own row, keeping 💾 Lưu + ✕ on the first row.
- **Header hidden under the status bar / URL bar (PWA + mobile):** the viewport meta uses
  `viewport-fit=cover`, so a plain `inset: 0` overlay starts *under* the notch/status bar and
  the header's ✕ becomes unclickable. Fixed in the shared dialog primitives, so every tab and
  every fullscreen dialog inherits it: `.dialog-backdrop` (and `.bg-setup-overlay`,
  `.bgj-overlay`) are sized with `100dvh` and padded by `max(<pad>, env(safe-area-inset-*))`,
  `.dialog--fullscreen` fills the padded content box with `height: 100%` instead of
  `calc(100vh - 32px)`, and `.dialog-backdrop` sits at `z-index: 300` — above the mobile
  topbar (100) and the sidebar drawer (200). The chart dialog's header also gets its own
  stacking context so nothing paints over the ✕.
- **Hedge vs one-way account mode:** honoured via `BITGET_POSITION_MODE` (adds `tradeSide:
  open` in hedge mode), same as the worker trade client.
- **Per-side leverage in hedge mode:** in hedge mode Bitget keeps a separate leverage per
  side even in cross margin, so `set-leverage` MUST include `holdSide` — otherwise the traded
  side keeps whatever the Bitget app had set and the requested leverage is silently ignored.
  The call passes `holdSide` in hedge mode, matching the worker trade client.
- **Priority never rated:** a coin with no row in `bitget_symbol_priorities` counts as **0**
  stars (all grey) and sorts to the bottom of the default order, keeping its pinned/watchlist
  position relative to the other 0-star coins.
- **Getting back to the default order:** with no Priority header to click, cycling a change
  column past "ascending" restores the star order (`DEFAULT_SORT`) rather than the pinned
  order, so the trader can always return to their own ranking without a reload.
- **Clearing a priority:** clicking the current rating's star writes `priority = 0` (the row is
  kept, not deleted), which is the only way back to "no priority".
- **Priority hydration / save failure:** a failed `GET` is non-fatal — every coin just shows 0
  stars. A failed `PUT` restores the previous rating and surfaces a red alert, so the order on
  screen never drifts from the DB.
- **H4 on a coin with no closed 4h candle yet / a failed fetch:** `h4ChangeFor` returns
  `null`, the cell shows "—", and the 7d/30d readings still land — the H4 fetch is wrapped in
  its own try/catch so it can never blank the whole row.
- **Attachments count out of date:** counts are fetched on mount and refreshed when the chart
  dialog closes, so a snapshot saved from that dialog is reflected right away. A count fetch
  failure is non-fatal — the column falls back to 0 and the gallery still opens with the real
  images.
- **No saved charts (Reference gallery):** if the coin has no saved snapshots the gallery shows
  a hint pointing to the History tab's 💾 Lưu action; a list-fetch failure shows a retry notice.
  Both are non-fatal — the rest of the tab keeps working.

- **A side left blank in the row ⚙ dialog:** the side is skipped entirely (no DB row written),
  so the table keeps showing "chưa cấu hình" instead of a silent `0` margin config.
- **Arming auto with no LONG margin:** the checkbox is disabled with an inline hint, and the API
  rejects it with 400 anyway — an armed coin the engine would only ever skip is worse than an
  obviously-off one.
- **Row ⚙ save fails halfway** (side saved, auto switch rejected): the dialog stays open with a
  red inline error and the sides that did land are already reflected in the table, so a retry
  only re-sends what is still missing.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/bitget/coin-setup-dialog.tsx` — the row's single ⚙ dialog: LONG + SHORT config blocks and the auto-entry switch (with the strategy spelled out + the coin's latest run).
- `apps/web/src/widgets/bitget/symbol-note-dialog.tsx` — **Đánh giá** dialog: shared TipTap `MarkdownEditor` (lazy-loaded) + Xem trước toggle rendering through `renderMarkdown`, and `notePreview()` used by the table cell.
- `apps/api/src/modules/bitget/dto/upsert-symbol-note.dto.ts` — validates `{ symbol, note }` for the assessment save.
- `packages/db/src/repositories/bitget-symbol-note.repository.ts` — `findAll()`, `upsert()`, `remove()` for the per-coin assessment.
- `packages/db/prisma/migrations/20260729170000_add_bitget_symbol_notes/migration.sql` — `bitget_symbol_notes` table DDL (`BitgetSymbolNote` model, unique on symbol, `note` LONGTEXT).
- `apps/web/src/widgets/bitget/bitget-setup-feed.tsx` — the Setup tab UI + config dialog + live price/change columns + Symbol cell (coin name + `ChartIcon` button + **priority stars underneath**, which drive the default sort) + `SetupChartDialog` + **Attachments** cell (🖼 + count) opening `ChartGalleryDialog` (thumbnail rail + enlarged main image).
- `apps/web/src/widgets/bitget/chart-icon.tsx` — shared `ChartIcon` (extracted from `bitget-positions-feed.tsx` on 2026-07-27) so all three tabs use the same icon.
- `apps/web/src/widgets/bitget/star-rating.tsx` — `StarRating` (0–5 stars, grey → yellow, hover preview, click-current-to-clear) + `MAX_PRIORITY`.
- `apps/api/src/modules/bitget/dto/upsert-symbol-priority.dto.ts` — validates `{ symbol, priority: 0–5 }`.
- `packages/db/src/repositories/bitget-symbol-priority.repository.ts` — `findAll()`, `upsert()` for the per-coin star rating.
- `packages/db/prisma/migrations/20260727120000_add_bitget_symbol_priority/migration.sql` — `bitget_symbol_priorities` table DDL.
- `packages/db/src/repositories/bitget-trade-chart.repository.ts` — `findBySymbol(symbol)` (all saved snapshots for one coin, newest first) alongside `findByTradeKey`; `countBySymbol()` (grouped count feeding the Attachments column).
- `apps/api/src/modules/bitget/bitget-setup-chart.service.ts` — `listSavedChartsBySymbol()` (normalises to `${bare}USDT`); `countSavedChartsBySymbol()` / `countSavedChartsByTradeKey()` (Attachments badges); `h4ChangeFor()` (last closed 4h candle move, folded into `getPriceChanges`); `saveSetupChart(symbol, tf)` snapshots the live chart to R2; TF_CONFIG limits + `TRADE_LOOKBACK_BARS` bumped so EMA200 warms.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/trade-chart/by-symbol?symbol=…` lists saved charts for a coin; `GET /bitget/trade-chart/counts` returns the per-coin chart count; `GET/PUT /bitget/setup/priority` reads/writes the star ratings; `GET/PUT /bitget/setup/note` reads/writes the per-coin assessment; `POST /bitget/setup-chart/save` snapshots the live Setup chart.
- `apps/api/src/modules/bitget/dto/save-setup-chart.dto.ts` — validates `{ symbol, timeframe }` for the Setup-chart save.
- `apps/web/src/widgets/bitget/setup-chart-dialog.tsx` — shared chart dialog; `allowSave` prop shows the 💾 Lưu button (Setup tab passes it, positions table does not).
- `apps/web/src/widgets/bitget/symbol-filter-input.tsx` — shared free-text coin-name filter + `matchesSymbolQuery` (used by the Setup toolbar, the Positions tab and the History tab); case-insensitive substring match, comma/space-separated terms match any, filters `displaySymbols` (empty query = all coins). While a query is active, `BulkSetupDialog` pre-selects the coins currently shown.
- `apps/web/src/shared/api/client.ts` — `fetchBitgetSavedChartsBySymbol(symbol)`, `saveBitgetSetupChart({ symbol, timeframe })`, `fetchBitgetChartCounts()`, `fetchBitgetSymbolPriorities()`, `saveBitgetSymbolPriority({ symbol, priority })`.
- `apps/web/src/app/globals.css` — `.bg-ref-btn`, `.bg-attach-*` (icon + count badge, dimmed at 0), `.bg-symbol-cell` / `.bg-symbol-name` (name + icon row, stars underneath), `.bg-stars` / `.bg-star` / `.bg-star--on` (grey → yellow), `.bg-chart-icon-btn` (shared), `.bg-gallery*` (rail thumbnails + enlarged main image, responsive stack). `.bg-chart-btn(s)` and `.bg-view-chart-btn` were deleted with the buttons they styled.
- `apps/api/src/modules/bitget/bitget-setup-chart.service.ts` — fetches M30 Binance klines, builds open/closed position markers (via `BitgetService`), renders the chart PNG, computes the per-timeframe QQE column (`getQqeSignals`, 60s cache), and the 7d/30d change column (`getPriceChanges`, daily candles, 5-min cache).
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/qqe-signals?symbols=…` returns the per-coin, per-timeframe QQE state for the Setup column. An optional `&timeframes=` (subset of `M30,1h,4h,1d,1w`) narrows the server-side scan; omitted here, so the Setup tab keeps the full M30/1h/4h/1d default. `/tracking-coins` passes `4h,1d,1w`. `GET /bitget/price-changes?symbols=…` returns the 7d/30d change ratio per coin.
- `apps/web/src/widgets/bitget/qqe-cell.tsx` — `QqeCell` + `isLiveSignal` + `bareQqeSymbol`, extracted from `bitget-setup-feed.tsx` (2026-07-26) so `/tracking-coins` renders the identical column; `timeframes` prop selects which switcher columns a page reports on.
- `apps/web/src/widgets/bitget/setup-chart-dialog.tsx` — the chart dialog now takes an optional `timeframes` prop (defaults to `CHART_TIMEFRAMES`); `SWING_CHART_TIMEFRAMES` (H4/D1/W1) is the swing-page variant. `1w` is a supported render timeframe.
- `apps/api/src/modules/bitget/setup-chart-renderer.ts` — chartjs-node-canvas renderer: candlesticks + SonicR (EMA34 H/L/C Dragon + EMA89) + **EMA200** (orange trend line) + **UT Bot (10,3)** trailing stop (`calcUtBotSignals` from `@app/core`, `UT_BOT_PARAMS`; two stepped datasets green/red + `utBotFlipPlugin` dots) + S/R channels + RSI(14) pane + FxCanli Volume (Hacim) pane + colinmck QQE Long/Short markers (via `calculateQqe` from `@app/core`) + Engulfing Candles Detector (`detectEngulfing`, colours the candle solid green/red — no box/label) + position-marker lines + trade-span (Vào/Đóng) markers.
- `apps/web/src/widgets/bitget-history/bitget-history-feed.tsx` — History tab: per-row M30/H1/H4/D1 buttons + `TradeChartDialog` (review chart + 💾 Lưu to R2).
- `packages/db/prisma/schema.prisma` / `bitget-trade-chart.repository.ts` — `BitgetTradeChart` model (saved trade-chart snapshots, unique on tradeKey+timeframe).
- `apps/web/src/widgets/bitget-positions/use-bitget-live-prices.ts` — WS ticker hook; returns `prices`, `changes` (UTC-0 ratio via `changeUtc24h`), `live`.
- `apps/web/src/widgets/bitget/bitget-tabs.tsx` — registers the third `setup` tab and renders the row count next to each tab label (seeded from the SSR snapshot, kept live by each feed's `onCount`); reuses `setupSymbols()` so the Setup count matches the table exactly.
- `apps/web/src/_pages/bitget-page/bitget-page.tsx` — supports `?tab=setup` deep-link.
- `apps/web/src/shared/api/client.ts` — `openBitgetPosition()`, `fetchBitgetSetupConfigs()`, `saveBitgetSetupConfig()`, `fetchBitgetPriceChanges()` (7d/30d change).
- `apps/web/src/shared/api/types.ts` — `BitgetSetupConfig` (now carries `symbol`), `BitgetOpenResult`, `BitgetPriceChange`, `BitgetSymbolPriority`, `BitgetSymbolNote`, `BitgetChartCount`.
- `apps/web/src/app/globals.css` — `.bg-setup-*`, `.bg-open-btn`, `.bg-alert--ok`, `.bg-price`, `.bg-chg--up/down`, `.bg-open-btn--short` (red short button), `.bg-side-cell`/`.bg-side-cell-inner`/`.bg-side-cfg` (per-side action cell + config summary), `.bg-symbol` sticky column, `.bg-bulk-*` + `.bg-setup-dialog--wide` (bulk dialog), `.bg-toolbar-right`.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `POST /bitget/positions/open`, `GET/PUT /bitget/setup`, `GET /bitget/setup-chart` (public PNG).
- `apps/api/src/modules/bitget/bitget.module.ts` — registers `BitgetSetupChartService` + `BinanceMarketDataService`.
- `apps/api/src/modules/bitget/bitget.service.ts` — `openPosition()` (size math + guards, `new` vs `add` scale-in) và `writeSystemLog()` (log nhật ký cho lần thêm volume).
- `apps/api/src/modules/bitget/bitget-setup.service.ts` — DB-backed per-side config list/upsert + `upsertMany()` (bulk, transactional) + `listPriorities()` / `upsertPriority()` (0–5 stars, `MAX_SYMBOL_PRIORITY`) + `listNotes()` / `upsertNote()` (per-coin assessment, `MAX_NOTE_LENGTH` 20 000, blank note deletes the row).
- `apps/api/src/modules/bitget/bitget.module.ts` — registers `BitgetSetupService` as a provider.
- `apps/api/src/modules/bitget/bitget-trade.client.ts` — `getTickerPrice`, `getContractSpec`,
  `setCrossLeverage`, `openMarketPosition`.
- `apps/api/src/modules/bitget/dto/open-position.dto.ts` — open-order validation.
- `apps/api/src/modules/bitget/dto/upsert-setup-config.dto.ts` — setup-config validation.
- `apps/api/src/modules/bitget/dto/bulk-upsert-setup-config.dto.ts` — bulk setup-config validation: `symbols[]` + nested `sides[]` (`BulkSetupSideDto`: holdSide, leverage, marginUsd).
- `packages/db/src/repositories/bitget-setup-config.repository.ts` — `findAll()`, `upsert()`, `upsertMany()` (one `$transaction`).
- `apps/web/src/widgets/bitget/bulk-setup-dialog.tsx` — bulk config dialog: per-side LONG/SHORT blocks (own leverage + margin), searchable coin grid, overwrite warning.
- `packages/db/prisma/schema.prisma` — `BitgetSetupConfig` model (`bitget_setup_configs`), `BitgetSymbolPriority` model (`bitget_symbol_priorities`, unique on `symbol`).
- `packages/db/src/repositories/bitget-setup-config.repository.ts` — `findAll()`, `upsert()`.
- `packages/db/prisma/migrations/20260720120000_add_bitget_setup_config/migration.sql` — table DDL.
