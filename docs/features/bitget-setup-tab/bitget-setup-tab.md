## Description
Adds a **Setup** tab to the Bitget dashboard (`/bitget`). It lists every coin that has
ever been traded (unique symbols pulled from the History tab) as one row each, with a
per-coin **Setup** dialog (direction, leverage, margin — margin mode is always **cross**,
order type is always **market**) and an **Open** button that places a live market order on
Bitget using that config. The Open button is disabled while the coin already has an open
position, or until its margin has been configured. Per-coin config is stored client-side in
`localStorage`.

## Main Flow
1. User opens `/bitget` → clicks the **Setup** tab (or lands via `?tab=setup`).
2. The feed builds a unique symbol list from `history.trades` (newest-closed first) and
   fetches live positions every 15s to know which symbols are currently open.
3. User clicks **⚙ Setup** on a row → a dialog (portaled to `document.body`) lets them set
   direction (LONG/SHORT), leverage (1–125×), and margin in USDT. Margin mode / order type
   are fixed to **Market · Cross**. Saving writes the config to `localStorage`
   (`bitget:setup-config`, keyed by symbol).
4. User clicks **Open** → confirm dialog → `POST /bitget/positions/open` via
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
- **Already open:** Open is disabled in the UI when the symbol is in the live positions set;
  the API also guards with a 409 so a stale UI can't double up.
- **Not configured:** Open is disabled until the coin's margin > 0; a hint tooltip explains.
- **Margin too small:** size floors below the contract minimum → API returns 400 with a
  Vietnamese message asking to raise margin/leverage.
- **Bitget not configured:** if credentials are missing the tab shows the same setup notice
  as the other tabs.
- **localStorage unavailable** (private mode/quota): reads/writes fail silently; config just
  isn't persisted.
- **Concurrent opens:** the Open buttons are disabled globally while any open is in flight
  (`openingKey !== null`).
- **Hedge vs one-way account mode:** honoured via `BITGET_POSITION_MODE` (adds `tradeSide:
  open` in hedge mode), same as the worker trade client.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/bitget/bitget-setup-feed.tsx` — the Setup tab UI + config dialog.
- `apps/web/src/widgets/bitget/bitget-tabs.tsx` — registers the third `setup` tab.
- `apps/web/src/_pages/bitget-page/bitget-page.tsx` — supports `?tab=setup` deep-link.
- `apps/web/src/shared/api/client.ts` — `openBitgetPosition()` client method.
- `apps/web/src/shared/api/types.ts` — `BitgetSetupConfig`, `BitgetOpenResult`.
- `apps/web/src/app/globals.css` — `.bg-setup-*`, `.bg-open-btn`, `.bg-alert--ok` styles.
- `apps/api/src/modules/bitget/bitget.controller.ts` — `POST /bitget/positions/open`.
- `apps/api/src/modules/bitget/bitget.service.ts` — `openPosition()` (size math + guards).
- `apps/api/src/modules/bitget/bitget-trade.client.ts` — `getTickerPrice`, `getContractSpec`,
  `setCrossLeverage`, `openMarketPosition`.
- `apps/api/src/modules/bitget/dto/open-position.dto.ts` — request validation.
