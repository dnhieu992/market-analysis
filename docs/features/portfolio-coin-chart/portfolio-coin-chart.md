## Description
A chart icon next to the coin name on the portfolio coin detail page
(`/portfolio/<portfolioId>/<coinId>`) that opens the same full-screen chart dialog used by
the `/bitget` Setup tab — SonicR system + EMA200 + UT Bot + S/R channels + RSI + QQE,
rendered server-side as a PNG. It lets the user check price structure for a holding without
leaving the portfolio page or switching to `/bitget`.

## Main Flow
1. User opens `/portfolio/<portfolioId>/<coinId>` (e.g. `.../ETH`).
2. The header renders the coin symbol followed by a `ChartIcon` button (`.bg-chart-icon-btn`,
   the same affordance as Bitget Positions / Setup / Tracking Coins).
3. Clicking it sets `chartOpen` and mounts `SetupChartDialog` with `symbol={coinId}`, using the
   dialog's defaults: `tf = 4h` and the intraday→D1 switcher (`M15 / M30 / H1 / H4 / D1`).
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
  page's card/backdrop-filter containers.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-coin-detail/portfolio-coin-detail.tsx` — renders the chart icon
  button in the header and mounts the dialog on click (`chartOpen` state)
- `apps/web/src/widgets/bitget/chart-icon.tsx` — shared monochrome candlestick icon (reused as-is)
- `apps/web/src/widgets/bitget/setup-chart-dialog.tsx` — shared full-screen chart dialog with the
  timeframe switcher (reused as-is)
- `apps/web/src/app/globals.css` — `.bg-chart-icon-btn` and `.eb-chart-*` dialog styles (global,
  already available on this page)
- `apps/api/src/modules/bitget/bitget.controller.ts` — `GET /bitget/setup-chart` (public, PNG)
- `apps/api/src/modules/bitget/bitget-setup-chart.service.ts` — symbol normalization + chart render
