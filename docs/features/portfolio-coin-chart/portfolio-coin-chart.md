## Description
A chart icon next to the coin name in two places — every row of the Holdings table on the
portfolio page (`/portfolio/<portfolioId>`) and the header of the coin detail page
(`/portfolio/<portfolioId>/<coinId>`) — that opens the same full-screen chart dialog used by
the `/bitget` Setup tab — SonicR system + EMA200 + UT Bot + S/R channels + RSI + QQE,
rendered server-side as a PNG. It lets the user check price structure for a holding without
leaving the portfolio page or switching to `/bitget`.

## Main Flow
### From the holdings list (`/portfolio/<portfolioId>`)
1. Each row's Coin cell renders the symbol link followed by the same `ChartIcon` button.
2. Clicking it sets `chartCoin` to that row's `coinId` and mounts one `SetupChartDialog` for the
   whole table — the dialog is rendered once at component level, not per row.
3. From there the flow is identical to steps 4-5 below. The row's Note / History buttons stay on
   the right of the cell; the chart button sits with the symbol on the left.

### From the coin detail page (`/portfolio/<portfolioId>/<coinId>`)
1. User opens `/portfolio/<portfolioId>/<coinId>` (e.g. `.../ETH`).
2. The header renders the coin symbol followed by a `ChartIcon` button (`.bg-chart-icon-btn`,
   the same affordance as Bitget Positions / Setup / Tracking Coins).
3. Clicking it sets `chartOpen` and mounts `SetupChartDialog` with `symbol={coinId}`, opening on
   `tf = 4h` with the full switcher `M15 / M30 / H1 / H4 / D1 / W1` (`FULL_CHART_TIMEFRAMES`).
   A portfolio holding is a swing position, so the weekly tab matters here even though the
   `/bitget` Setup tab stops at D1.
4. The dialog fetches `GET /bitget/setup-chart?symbol=<coinId>&timeframe=<tf>` with
   `credentials: 'include'`, turns the PNG into a blob URL and shows it. The API normalizes the
   bare symbol to `<coinId>USDT` before pulling public Binance klines, so `ETH` works as-is.
5. Switching a timeframe tab re-fetches the PNG in place. Escape or the backdrop closes the dialog.

## Edge Cases
- **Bare vs pair symbol** — portfolio holdings store bare symbols (`ETH`, `BTC`); the chart service
  strips a trailing `USDT` and re-appends it, so both forms resolve to the same Binance pair.
- **Coin not listed on Binance** — the render fails and the dialog shows
  "Không tải được chart. Thử lại sau." instead of an empty frame.
- **Save disabled** — `allowSave` is not passed, so no "💾 Lưu" button appears. Saving would file the
  chart under the Bitget coin reference gallery, which does not belong to a portfolio holding.
- **Bitget trade markers** — if the same coin has Bitget trades, the shared renderer overlays their
  entry markers. This is inherited from the shared endpoint and is informational only.
- **Dialog stacking** — `SetupChartDialog` portals to `document.body`, so it is not clipped by the
  page's card/backdrop-filter containers. On the holdings list this also keeps it clear of the
  table's own scroll container (`.tt-wrap`).
- **Sold-out rows** — a holding with `totalAmount <= 0` is dimmed but still gets a chart button;
  the chart reads the market, not the position.
- **One dialog per table** — the holdings list keeps a single `chartCoin` symbol rather than open
  state per row, so switching coins cannot leave two dialogs mounted.
- **W1 on a young coin** — the weekly render falls back to whatever history Binance returns
  (`TF_CONFIG['1w']` asks for 300 bars, displays 80); a recent listing simply shows fewer candles.
- **W1 stays off the Setup-tab QQE column** — `FULL_CHART_TIMEFRAMES` is a separate constant rather
  than an addition to `CHART_TIMEFRAMES`, because that set also feeds `qqe-cell.tsx`, where an extra
  timeframe costs one more Binance call per listed coin.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — renders the chart icon
  button in the header and mounts the dialog on click (`chartOpen` state)
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` — renders the chart
  icon per Holdings row and mounts one shared dialog (`chartCoin` state)
- `apps/web/src/widgets/bitget/chart-icon.tsx` — shared monochrome candlestick icon (reused as-is)
- `apps/web/src/widgets/bitget/setup-chart-dialog.tsx` — shared full-screen chart dialog with the
  timeframe switcher; defines `FULL_CHART_TIMEFRAMES` (M15 → W1) used by this page
- `apps/web/src/app/globals.css` — `.bg-chart-icon-btn` and `.eb-chart-*` dialog styles (global,
  already available on this page)
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/setup-chart` (public, PNG)
- `apps/api/src/modules/bitget/bitget-setup-chart.service.ts` — symbol normalization + chart render
