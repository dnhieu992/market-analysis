# Daily Long Signal Feature

## Muc tieu

Moi ngay luc 00:00 UTC, worker tu dong kiem tra tung dong coin trong "Daily Signal Watchlist" cua user. Neu M30 UT Bot dang uptrend thi coin do duoc xem la co the long hom nay. Worker gui mot tin nhan Telegram tong hop danh sach cac coin du dieu kien.

User quan ly danh sach coin qua trang Profile (Daily Signal Watchlist — rieng biet voi Swing Signal Watchlist).

---

## Chien luoc ap dung

- **Indicator:** UT Bot (Wilder RMA ATR + trailing stop)
- **Timeframe:** M30 (30 phut)
- **Dieu kien:** `close > UT Bot trailing stop` (uptrend)
- **Parameters:** `period = 10`, `multiplier = 1`
- **Hanh dong:** Gui 1 tin nhan Telegram tong hop: danh sach coin longable hoac thong bao khong co coin nao du dieu kien
- **Khong luu DB** — chi send notification

---

## Plan & Checklist

### 1. Core — Extract UT Bot indicator vao `@app/core`

- [x] **`packages/core/src/indicators/ut-bot.ts`** — implement:
  - `calcRmaAtr(candles, period)` — Wilder RMA-based ATR
  - `calcUtBotTrailingStop(candles, period, multiplier)` — UT Bot trailing stop
  - `isUtBotUptrend(candles, period, multiplier): boolean` — export chinh
- [x] **`packages/core/src/index.ts`** — export `isUtBotUptrend`

---

### 2. Backtest — Refactor `fomo-long.strategy.ts`

- [x] **`apps/api/src/modules/back-test/strategies/fomo-long.strategy.ts`** — thay the inline UT Bot implementation bang import `isUtBotUptrend` tu `@app/core`

---

### 3. Database — them `dailySignalWatchlist` vao User

- [x] **`packages/db/prisma/schema.prisma`** — them field vao model `User`:
  ```prisma
  dailySignalWatchlist Json @default("[]")
  ```
- [x] **`packages/db/prisma/migrations/20260504130000_add_daily_signal_watchlist/migration.sql`** — tao migration:
  ```sql
  ALTER TABLE `users` ADD COLUMN `dailySignalWatchlist` JSON NOT NULL DEFAULT ('[]');
  ```
- [x] Chay `pnpm prisma:generate` de regenerate Prisma client

---

### 4. API — expose `dailySignalWatchlist` trong user profile

- [x] **`apps/api/src/modules/user/dto/update-profile.dto.ts`** — them `dailySignalWatchlist?: string[]`
- [x] **`apps/api/src/modules/user/user.service.ts`** — include `dailySignalWatchlist` trong `getProfile()` va `updateProfile()`

---

### 5. Frontend — them Daily Signal Watchlist UI

- [x] **`apps/web/src/shared/api/types.ts`** — them `dailySignalWatchlist: string[]` vao `UserProfile`
- [x] **`apps/web/src/shared/api/client.ts`** — cap nhat type signature cua `updateUserProfile` chap nhan `dailySignalWatchlist`
- [x] **`apps/web/src/_pages/profile-page/profile-page.tsx`** — them section "Daily Signal Watchlist" (add/remove tag UI, state rieng `dailySymbols`)

---

### 6. Worker — DailySignalService

- [x] Tao **`apps/worker/src/modules/daily-signal/daily-signal.service.ts`**:
  - Doc `user.dailySignalWatchlist` qua `userRepository.findFirst()`
  - Voi moi symbol: fetch 60 nen M30 tu Binance → chay `isUtBotUptrend(candles, 10, 1)`
  - Thu thap cac symbol co ket qua `true`
  - Gui 1 tin nhan Telegram tong hop
- [x] Tao **`apps/worker/src/modules/daily-signal/daily-signal.module.ts`**

---

### 7. Scheduler — wire vao cron 00:00 UTC

- [x] **`apps/worker/src/modules/scheduler/scheduler.service.ts`** — inject `DailySignalService`, goi `checkAndSend()` trong `sendDailySignals()`
- [x] **`apps/worker/src/modules/scheduler/scheduler.module.ts`** — import `DailySignalModule`

---

## Telegram message format

**Neu co coin longable:**
```
📈 Coins can long today (UT Bot M30 uptrend):
BTCUSDT, SUIUSDT
```

**Neu khong co coin nao du dieu kien:**
```
📊 Daily Long Signal — No coins qualify today.

Checked: BTCUSDT, ETHUSDT, SUIUSDT
None are in UT Bot M30 uptrend.
```

---

## Files / Folders bi anh huong

```
packages/
  core/
    src/indicators/
      ut-bot.ts                                      <- NEW
    src/index.ts                                     <- EXPORT isUtBotUptrend
  db/
    prisma/
      schema.prisma                                  <- ADD dailySignalWatchlist to User
      migrations/
        20260504130000_add_daily_signal_watchlist/
          migration.sql                              <- NEW

apps/
  api/
    src/modules/
      back-test/strategies/
        fomo-long.strategy.ts                        <- REFACTOR (use @app/core)
      user/
        dto/update-profile.dto.ts                    <- ADD dailySignalWatchlist
        user.service.ts                              <- INCLUDE dailySignalWatchlist

  worker/
    src/modules/
      daily-signal/                                  <- NEW MODULE
        daily-signal.service.ts
        daily-signal.module.ts
      scheduler/
        scheduler.service.ts                         <- CALL DailySignalService
        scheduler.module.ts                          <- IMPORT DailySignalModule

  web/
    src/
      _pages/profile-page/
        profile-page.tsx                             <- ADD Daily Signal Watchlist section
      shared/api/
        types.ts                                     <- ADD dailySignalWatchlist to UserProfile
        client.ts                                    <- UPDATE updateUserProfile type
```

---

## Notes

- Worker query DB truc tiep (khong qua API) vi da co `@app/db` trong monorepo
- Chi dung `findFirst()` vi hien tai chi co 1 user
- Neu `dailySignalWatchlist` rong → worker skip, khong gui Telegram, khong bao loi
- Neu fetch candles that bai cho 1 symbol → log error, skip symbol do, cac symbol khac van tiep tuc
- Neu so nen < `period + 1` (11) → `isUtBotUptrend` tra ve `false`, symbol bi bo qua
- Chi gui **1 tin nhan duy nhat** tong hop tat ca symbols (khac voi swing signal gui rieng tung coin)
- UT Bot duoc share giua `DailySignalService` (worker) va `FomoLongStrategy` (backtest) qua `@app/core`
- Cron 00:00 UTC da ton tai (`sendDailySignals`) — `DailySignalService.checkAndSend()` duoc append vao cuoi job do
