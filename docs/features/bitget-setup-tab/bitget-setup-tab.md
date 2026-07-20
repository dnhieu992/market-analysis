## Description
Adds a **Setup** tab to the Bitget dashboard (`/bitget`). It lists every coin that has
ever been traded (unique symbols pulled from the History tab) as **one row each**, with a
separate **Long** and **Short** action cell. Each side has its own **⚙ Setup** dialog
(leverage, margin — direction is fixed by the cell, margin mode is always **cross**, order
type is always **market**) and its own **Long / Short** open button that places a live market
order on Bitget using that side's config. Each button is disabled **independently** while that
exact coin **+ side** already has an open position, or until that side's margin has been
configured — so an open long disables only **Long**, leaving **Short** live. Per-side config is
persisted in the **database** (`bitget_setup_configs`, unique on `symbol + holdSide`) so it
survives reloads and is shared across devices. Each coin's **realtime price** and **change
since 00:00 UTC** (streamed from Bitget's public WebSocket ticker) show once per row.

Each coin row also has a **📈 Chart** button that opens a fullscreen dialog with a server-rendered
**M30** PNG chart carrying TradingView-default indicators: the **SonicR system** (EMA34
of high/low/close as the green "Dragon" ribbon + EMA89 trend line), **Support/Resistance
Channels** (LonesomeTheBlue-style pivot channels), **RSI(14)**, a **FxCanli Volume (Hacim)**
pane (per-bar volume histogram coloured by candle direction + MA20), and **colinmck "QQE
Signals" (14,5,4.238)** markers drawn on the price candles — a green ▲ **Long** below the candle
where the QQE trailing line crosses under RSI-MA, a red ▼ **Short** above where it crosses over.
The chart is read-only / non-persisted — it just fetches and displays the latest render.

The chart also overlays **position markers**: every live open position for the coin draws a
solid entry line (green LONG / red SHORT) tagged with entry price + live uPnL, and the most
recent **closed** trade that closed **within the last 30 minutes** draws a grey dashed entry
line plus a win/loss-coloured dashed close line tagged with realized PnL ("lãi"/"lỗ") — once a
trade has been shut longer than 30 minutes its markers drop off. Markers are looked up
server-side from live positions + closed history; the lookup is non-fatal.

## Main Flow
1. User opens `/bitget` → clicks the **Setup** tab (or lands via `?tab=setup`).
2. The feed builds a unique symbol list from `history.trades` (newest-closed first) and renders
   one row per coin, each with a **Long** and a **Short** action cell (config summary + ⚙ + open
   button). It hydrates saved configs once via `GET /bitget/setup`,
   fetches live positions every 15s to know which coin+sides are currently open, and subscribes
   to the Bitget public WS `ticker` channel for every listed symbol to show live price + change
   since 00:00 UTC (green/red). A "Realtime / Đang kết nối…" pill reflects the WS state.
3. User clicks **⚙** in a side cell → a dialog (portaled to `document.body`) lets them set
   leverage (1–125×) and margin in USDT for that cell's fixed side. Margin mode / order type
   are fixed to **Market · Cross**. Saving optimistically updates the cell and persists via
   `PUT /bitget/setup` (upsert on `symbol + holdSide`).
4. User clicks **Long** or **Short** → confirm dialog → `POST /bitget/positions/open` via
   `openBitgetPosition()`. The API:
   - rejects (409) if a position for that symbol+side is already open;
   - reads the live ticker price + contract precision;
   - computes size = `margin × leverage ÷ price`, floored to the contract's `volumePlace`
     (rejected 400 if below `minTradeNum`);
   - sets cross leverage, then places a **market** order (`marginMode: crossed`, no preset
     TP/SL — a deliberate manual entry).
5. On success a green notice shows the filled size/price and positions refresh, flipping the
   coin to "Đang mở" and disabling its Open button.

## Edge Cases
- **Already open (per side):** the side's open button is disabled in the UI when that
  `symbol+holdSide` is in the live positions set — the **Long** button can be disabled while
  **Short** stays enabled, and vice versa. The API also guards with a 409 so a stale UI can't
  double up.
- **Not configured:** Open is disabled until that side's margin > 0; a hint tooltip explains.
- **Margin too small:** size floors below the contract minimum → API returns 400 with a
  Vietnamese message asking to raise margin/leverage.
- **Bitget not configured:** if credentials are missing the tab shows the same setup notice
  as the other tabs.
- **Config fetch/save fails:** hydration failure is non-fatal (rows show unconfigured);
  a save failure surfaces a red alert and the optimistic row state is kept.
- **Concurrent opens:** the Open buttons are disabled globally while any open is in flight
  (`openingKey !== null`).
- **Hedge vs one-way account mode:** honoured via `BITGET_POSITION_MODE` (adds `tradeSide:
  open` in hedge mode), same as the worker trade client.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/bitget/bitget-setup-feed.tsx` — the Setup tab UI + config dialog + live price/change columns + 📈 Chart button and `SetupChartDialog`.
- `apps/api/src/modules/bitget/bitget-setup-chart.service.ts` — fetches M30 Binance klines, builds open/closed position markers (via `BitgetService`), and renders the chart PNG.
- `apps/api/src/modules/bitget/setup-chart-renderer.ts` — chartjs-node-canvas renderer: candlesticks + SonicR (EMA34 H/L/C Dragon + EMA89) + S/R channels + RSI(14) pane + FxCanli Volume (Hacim) pane + colinmck QQE Long/Short markers (via `calculateQqe` from `@app/core`) + position-marker lines + trade-span (Vào/Đóng) markers.
- `apps/web/src/widgets/bitget-history/bitget-history-feed.tsx` — History tab: per-row M30/H1/H4/D1 buttons + `TradeChartDialog` (review chart + 💾 Lưu to R2).
- `packages/db/prisma/schema.prisma` / `bitget-trade-chart.repository.ts` — `BitgetTradeChart` model (saved trade-chart snapshots, unique on tradeKey+timeframe).
- `apps/web/src/widgets/bitget-positions/use-bitget-live-prices.ts` — WS ticker hook; returns `prices`, `changes` (UTC-0 ratio via `changeUtc24h`), `live`.
- `apps/web/src/widgets/bitget/bitget-tabs.tsx` — registers the third `setup` tab.
- `apps/web/src/_pages/bitget-page/bitget-page.tsx` — supports `?tab=setup` deep-link.
- `apps/web/src/shared/api/client.ts` — `openBitgetPosition()`, `fetchBitgetSetupConfigs()`, `saveBitgetSetupConfig()`.
- `apps/web/src/shared/api/types.ts` — `BitgetSetupConfig` (now carries `symbol`), `BitgetOpenResult`.
- `apps/web/src/app/globals.css` — `.bg-setup-*`, `.bg-open-btn`, `.bg-alert--ok`, `.bg-price`, `.bg-chg--up/down`, `.bg-open-btn--short` (red short button), `.bg-side-cell`/`.bg-side-cell-inner`/`.bg-side-cfg` (per-side action cell + config summary), `.bg-symbol` sticky column.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `POST /bitget/positions/open`, `GET/PUT /bitget/setup`, `GET /bitget/setup-chart` (public PNG).
- `apps/api/src/modules/bitget/bitget.module.ts` — registers `BitgetSetupChartService` + `BinanceMarketDataService`.
- `apps/api/src/modules/bitget/bitget.service.ts` — `openPosition()` (size math + guards).
- `apps/api/src/modules/bitget/bitget-setup.service.ts` — DB-backed per-side config list/upsert.
- `apps/api/src/modules/bitget/bitget.module.ts` — registers `BitgetSetupService` as a provider.
- `apps/api/src/modules/bitget/bitget-trade.client.ts` — `getTickerPrice`, `getContractSpec`,
  `setCrossLeverage`, `openMarketPosition`.
- `apps/api/src/modules/bitget/dto/open-position.dto.ts` — open-order validation.
- `apps/api/src/modules/bitget/dto/upsert-setup-config.dto.ts` — setup-config validation.
- `packages/db/prisma/schema.prisma` — `BitgetSetupConfig` model (`bitget_setup_configs`).
- `packages/db/src/repositories/bitget-setup-config.repository.ts` — `findAll()`, `upsert()`.
- `packages/db/prisma/migrations/20260720120000_add_bitget_setup_config/migration.sql` — table DDL.
