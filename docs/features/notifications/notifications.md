# Notifications (order fills · Telegram + in-app)

Shipped 2026-11-08. First notification type: **`order_filled`** — every fill on the Bitget and
MEXC USDT-futures accounts (the two exchanges of /trading-list): new entry, DCA, partial/full
close, TP/SL, liquidation. Covers orders from the app *and* from the exchange apps.

## Flow
- Worker `OrderFillNotifyService` (`apps/worker/src/modules/order-fill-notify/`), cron
  `7,22,37,52 * * * * *`: reads fills since the per-exchange cursor (`notification_sync_state`,
  id `order_fill:<exchange>`) minus a 5-min overlap.
  - Bitget `GET /api/v2/mix/order/fill-history` · MEXC `GET /api/v1/private/order/list/order_deals`
    (both keyed by FILL time, so a limit order resting for days is caught when it fills).
  - Fills are grouped per order → one `notifications` row per order, `dedupeKey = <exchange>:<orderId>`.
    Fill ids live in `payload.fills`, so the overlap never duplicates. An order that fills more later
    is refreshed (unread again, re-sent with "(khớp thêm)").
  - Phase (Mở mới / DCA / Đóng 1 phần / Đóng hết) comes from the live positions read right after.
    TP/SL tag: Bitget `orderSource` (order detail). MEXC: only liquidation (category 2).
  - **First run only anchors the cursor** — no replay of old fills. Max catch-up after downtime: 3 days.
- Telegram: `TELEGRAM_NOTIFY_CHAT_ID` (optional) else `TELEGRAM_CHAT_ID`. A failed push is retried
  by the `40 * * * * *` cron (max 3 tries, 6 h window).
- API `apps/api/src/modules/notifications`: `GET /notifications?cursor&limit&unread=1&exchange=`,
  `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`.
- Web: sidebar item "Thông báo" with unread badge (+ bell on the mobile topbar), polled every 30 s;
  page `/notifications` (filters read/exchange, mark read, load more, auto-refresh 20 s).

## Adding a new notification type
Write a `notifications` row with a new `type` and a stable `dedupeKey`, then push it via
`TelegramService.sendToChat` and `markTelegram`. The web lists every type; `payload` is free-form.
