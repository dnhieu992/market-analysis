# Swing Signal Feature

## Mục tiêu

Sau mỗi nến H4 đóng cửa, worker tự động kiểm tra RSI(14) của các đồng coin mà user đang theo dõi (`symbolsTracking`). Nếu RSI ≤ 30 (oversold) thì gửi thông báo Telegram để alert cơ hội vào lệnh Long theo chiến lược RSI Reversal.

User quản lý danh sách coin theo dõi qua trang Profile (thay thế footnote cũ trong sidebar).

---

## Chiến lược áp dụng

- **RSI Period:** 14, timeframe H4
- **Điều kiện:** RSI ≤ 30
- **Hành động:** Gửi Telegram alert với symbol, giá hiện tại, giá RSI, TP +10%, SL -10%
- **Không lưu DB** — chỉ send notification

---

## Plan & Checklist

### 1. Database — thêm `symbolsTracking` vào User

- [ ] **`packages/db/prisma/schema.prisma`** — thêm field vào model `User`:
  ```prisma
  symbolsTracking Json @default("[]")
  ```
- [ ] Chạy migration: `pnpm prisma migrate dev --name add_user_symbols_tracking`
- [ ] **`packages/db/src/repositories/user.repository.ts`** — cập nhật `findByEmail`, `findById`, `create`, thêm method `updateSymbolsTracking(userId, symbols)` và `findFirst()` (lấy user duy nhất cho worker)

---

### 2. API — User profile endpoint

- [ ] **`apps/api/src/modules/auth/auth.types.ts`** — thêm `symbolsTracking: string[]` vào `AuthUser`
- [ ] **`apps/api/src/modules/auth/auth.service.ts`** — include `symbolsTracking` trong `toAuthUser()`
- [ ] Tạo **`apps/api/src/modules/user/dto/update-profile.dto.ts`**:
  ```ts
  { name?: string; symbolsTracking?: string[] }
  ```
- [ ] Tạo **`apps/api/src/modules/user/user.service.ts`** — `getProfile(userId)`, `updateProfile(userId, dto)`
- [ ] Tạo **`apps/api/src/modules/user/user.controller.ts`**:
  - `GET /user/profile` → trả về profile + symbolsTracking
  - `PATCH /user/profile` → update name + symbolsTracking
- [ ] Tạo **`apps/api/src/modules/user/user.module.ts`**
- [ ] **`apps/api/src/app.module.ts`** — import `UserModule`

---

### 3. Frontend — User profile & sidebar

#### Sidebar
- [ ] **`apps/web/src/widgets/app-shell/sidebar-nav.tsx`**:
  - Xoá footnote `"Overview, trades, and worker analysis in one place."`
  - Thêm user avatar + tên + email ở cuối sidebar (fetch từ `GET /auth/me`)
  - Click vào user info → navigate `/profile`
  - Sidebar trở thành `'use client'` để fetch user

#### API client & types
- [ ] **`apps/web/src/shared/api/types.ts`** — thêm `UserProfile` type:
  ```ts
  type UserProfile = { id: string; email: string; name: string; symbolsTracking: string[] }
  ```
- [ ] **`apps/web/src/shared/api/client.ts`** — thêm:
  - `fetchUserProfile()` → `GET /user/profile`
  - `updateUserProfile(data)` → `PATCH /user/profile`

#### Profile page
- [ ] Tạo **`apps/web/src/app/profile/page.tsx`** — server component, load profile
- [ ] Tạo **`apps/web/src/_pages/profile-page/profile-page.tsx`** — client component:
  - Hiển thị: avatar (initials), email, name
  - Form edit: name, danh sách symbolsTracking (add/remove tags giống settings page)
  - Submit gọi `PATCH /user/profile`

---

### 4. Worker — Swing Signal job

#### SwingSignal module
- [ ] Tạo **`apps/worker/src/modules/swing-signal/swing-signal.service.ts`**:
  - Import `@app/db` để query `User.findFirst()` → lấy `symbolsTracking`
  - Với mỗi symbol: fetch 20 nến H4 từ Binance → tính RSI(14) dùng `calculateRsi` từ `@app/core`
  - Nếu RSI ≤ 30: gọi `TelegramService.sendAnalysisMessage()` với message alert
  - Format message: symbol, giá hiện tại, RSI value, TP/SL gợi ý
- [ ] Tạo **`apps/worker/src/modules/swing-signal/swing-signal.module.ts`**
- [ ] **`apps/worker/src/worker.module.ts`** — import `SwingSignalModule`

#### Cron job
- [ ] **`apps/worker/src/modules/scheduler/scheduler.service.ts`** — thêm cron H4:
  ```ts
  @Cron('0 0,4,8,12,16,20 * * *', { timeZone: 'UTC' })
  async checkSwingSignals() { ... }
  ```
- [ ] **`apps/worker/src/modules/scheduler/scheduler.module.ts`** — import `SwingSignalModule`

#### Telegram message format
- [ ] Tạo **`packages/core/src/telegram/format-swing-signal-message.ts`**:
  ```
  🔔 SWING SIGNAL — BTCUSDT H4
  RSI(14): 28.4 — Oversold zone

  💰 Current price: $84,200
  🎯 Take Profit: $92,620 (+10%)
  🛑 Stop Loss:   $75,780 (-10%)

  ⚠️ Đây là tín hiệu tự động theo chiến lược RSI Reversal.
  ```
- [ ] Export từ **`packages/core/src/index.ts`**

---

## Files / Folders bị ảnh hưởng

```
packages/
  db/
    prisma/
      schema.prisma                          ← ADD symbolsTracking to User
    src/repositories/
      user.repository.ts                     ← ADD findFirst(), updateSymbolsTracking()
  core/
    src/telegram/
      format-swing-signal-message.ts         ← NEW
    src/index.ts                             ← EXPORT new formatter

apps/
  api/
    src/modules/
      auth/
        auth.types.ts                        ← ADD symbolsTracking
        auth.service.ts                      ← INCLUDE symbolsTracking in toAuthUser
      user/                                  ← NEW MODULE
        dto/update-profile.dto.ts
        user.service.ts
        user.controller.ts
        user.module.ts
      app.module.ts                          ← REGISTER UserModule

  worker/
    src/
      modules/
        swing-signal/                        ← NEW MODULE
          swing-signal.service.ts
          swing-signal.module.ts
        scheduler/
          scheduler.service.ts               ← ADD H4 cron
          scheduler.module.ts                ← IMPORT SwingSignalModule
      worker.module.ts                       ← IMPORT SwingSignalModule

  web/
    src/
      app/
        profile/
          page.tsx                           ← NEW PAGE
      _pages/
        profile-page/
          profile-page.tsx                   ← NEW COMPONENT
      widgets/
        app-shell/
          sidebar-nav.tsx                    ← REPLACE footnote with user info
      shared/api/
        types.ts                             ← ADD UserProfile type
        client.ts                            ← ADD fetchUserProfile, updateUserProfile
```

---

## Notes

- Worker query DB trực tiếp (không qua API) vì đã có `@app/db` trong monorepo
- Chỉ dùng `findFirst()` vì hiện tại chỉ có 1 user
- Nếu `symbolsTracking` rỗng → worker skip job, không báo lỗi
- Cron H4 chạy đúng sau khi nến đóng: `0 0,4,8,12,16,20 * * *` UTC
- Không cần `forcedTimeframe` vì swing signal luôn dùng H4
- RSI check dùng lại `calculateRsi` từ `@app/core` — không viết lại
