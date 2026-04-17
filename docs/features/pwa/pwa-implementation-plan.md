# PWA Implementation Plan

## Overview
Progressive Web App upgrade for the Market Analysis crypto trading platform (Next.js 13 App Router).

---

## Phase 1 — Installable App
> Make the app installable on mobile and desktop via home screen / taskbar.

### Setup
- [x] Install `next-pwa` package in `apps/web`
- [x] Configure `apps/web/next.config.js` with `next-pwa` plugin (disable in dev, enable in prod)

### Manifest
- [x] Create `apps/web/public/manifest.json` with name, short_name, start_url, display, theme_color, background_color
- [x] Set `display: "standalone"` for app-like full-screen feel
- [x] Add `scope` and `orientation` fields

### Icons
- [x] Generate icon set from app logo:
  - [x] `public/icons/icon-72x72.png`
  - [x] `public/icons/icon-96x96.png`
  - [x] `public/icons/icon-128x128.png`
  - [x] `public/icons/icon-144x144.png`
  - [x] `public/icons/icon-152x152.png`
  - [x] `public/icons/icon-192x192.png`
  - [x] `public/icons/icon-384x384.png`
  - [x] `public/icons/icon-512x512.png`
  - [x] `public/icons/icon-maskable-192x192.png` (maskable for Android adaptive icons)
  - [x] `public/icons/icon-maskable-512x512.png`
- [x] Reference all icons in `manifest.json` with correct `purpose` fields

### Meta Tags (layout.tsx)
- [x] Add `<link rel="manifest" href="/manifest.json">` to `apps/web/src/app/layout.tsx`
- [x] Add `<meta name="theme-color" content="...">`
- [x] Add `<meta name="application-name" content="Market Analysis">`
- [x] Add Apple iOS meta tags:
  - [x] `<meta name="apple-mobile-web-app-capable" content="yes">`
  - [x] `<meta name="apple-mobile-web-app-status-bar-style">`
  - [x] `<meta name="apple-mobile-web-app-title">`
  - [x] `<link rel="apple-touch-icon" href="...">`
- [x] Add Microsoft tile meta tags (optional)

### Verification
- [ ] Lighthouse PWA audit passes installability checks
- [ ] "Add to Home Screen" prompt works on Android Chrome
- [ ] App opens in standalone mode (no browser chrome)
- [ ] App icon displays correctly on home screen

---

## Phase 2 — Offline & Caching Strategy
> Show cached data when offline. Improve load speed with smart caching.

### Service Worker Configuration
- [ ] Configure Workbox runtime caching rules in `next.config.js`:
  - [ ] Static assets (JS/CSS/fonts): **Cache First** strategy
  - [ ] Images: **Cache First** with max 60 entries, 30-day expiry
  - [ ] `/api/analysis*`: **Stale While Revalidate**
  - [ ] `/api/portfolio*`: **Stale While Revalidate**
  - [ ] `/api/auth/*`: **Network Only** (security-sensitive)
  - [ ] Next.js pages: **Network First** with offline fallback

### Offline Fallback Page
- [ ] Create `apps/web/public/offline.html` as static fallback
- [ ] Style fallback page to match app theme
- [ ] Register fallback in Workbox config

### Offline UI Indicator
- [ ] Create `apps/web/src/components/OfflineBanner.tsx`
  - [ ] Detects `navigator.onLine` and `online`/`offline` events
  - [ ] Shows banner: "You are offline — viewing cached data"
  - [ ] Hides when connection is restored
- [ ] Mount `OfflineBanner` in root layout

### Verification
- [ ] Chrome DevTools → Application → Service Workers shows active SW
- [ ] DevTools → Network → Offline: portfolio and analysis pages load from cache
- [ ] Auth pages correctly fall through to network-only (no stale auth)
- [ ] Offline banner appears/disappears correctly

---

## Phase 3 — Web Push Notifications
> Alert traders when a new analysis signal fires (complements existing Telegram alerts).

### Database
- [ ] Add `push_subscriptions` table to `packages/db/prisma/schema.prisma`:
  ```
  id, userId, endpoint, p256dh, auth, createdAt
  ```
- [ ] Run Prisma migration: `pnpm prisma migrate dev --name add_push_subscriptions`
- [ ] Add repository helper in `packages/db`

### Backend — NestJS API (`apps/api/src/push/`)
- [ ] Install `web-push` and `@types/web-push` in `apps/api`
- [ ] Generate VAPID key pair (one-time): `npx web-push generate-vapid-keys`
- [ ] Store VAPID keys in `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)
- [ ] Create `PushModule`, `PushService`, `PushController`
- [ ] Implement `POST /push/subscribe` — save subscription to DB
- [ ] Implement `DELETE /push/subscribe` — remove subscription from DB
- [ ] Implement `GET /push/vapid-public-key` — expose public key to frontend
- [ ] Implement internal `PushService.sendToUser(userId, payload)` method
- [ ] Register `PushModule` in `AppModule`

### Backend — Worker Integration (`apps/worker`)
- [ ] After analysis completes, call `PushService.sendToUser` (or HTTP to API)
- [ ] Push payload: `{ title: "New Signal", body: "BTC — BUY @ 84,200", url: "/analysis" }`
- [ ] Handle push send errors gracefully (do not fail analysis job)

### Frontend — Subscription Flow (`apps/web`)
- [ ] Fetch VAPID public key from API on client
- [ ] Create `apps/web/src/lib/push.ts`:
  - [ ] `subscribeToPush()` — requests permission + registers SW push subscription
  - [ ] `unsubscribeFromPush()` — unsubscribes and calls DELETE endpoint
- [ ] Add push notification toggle to `/settings` page:
  - [ ] Show current permission state (granted / denied / default)
  - [ ] Enable/disable toggle calls subscribe/unsubscribe
  - [ ] Handle denied permission with instructions to re-enable
- [ ] Handle `push` event in service worker — show notification via `self.registration.showNotification()`
- [ ] Handle `notificationclick` event — focus/open app to relevant page

### Verification
- [ ] Subscription stored in DB after enabling in settings
- [ ] Notification appears when worker completes an analysis run
- [ ] Clicking notification navigates to `/analysis`
- [ ] Unsubscribing removes record from DB
- [ ] No crash if push send fails during worker run

---

## Phase 4 — Background Sync (Optional)
> Queue trade/transaction form submissions when offline, replay when back online.

### Service Worker
- [ ] Register Background Sync tag (`add-transaction-sync`) in SW
- [ ] Intercept `POST /api/portfolio/*/transactions` fetch in SW
- [ ] If offline: store request payload in IndexedDB, return optimistic response
- [ ] On `sync` event: replay queued requests from IndexedDB

### Frontend UI
- [ ] Show "Queued — will sync when online" toast after offline submission
- [ ] Show "Synced successfully" toast when background sync completes
- [ ] Create `apps/web/src/lib/syncQueue.ts` for IndexedDB read/write helpers

### Verification
- [ ] Add transaction while offline → queued toast appears
- [ ] Reconnect → sync fires → transaction appears in portfolio
- [ ] Duplicate prevention if sync fires multiple times

---

## Final Checklist

### Cross-cutting Concerns
- [ ] Service worker does not cache sensitive auth tokens or session cookies
- [ ] PWA works correctly behind the auth middleware (`/middleware.ts`)
- [ ] `next-pwa` configured to skip SW in `development` mode (avoids confusing caching during dev)
- [ ] All icons and manifest validated via [web.dev/measure](https://web.dev/measure)
- [ ] Lighthouse PWA score ≥ 90

### Browser / Device Testing
- [ ] Android Chrome — install + offline + push
- [ ] iOS Safari — install (no push support on iOS < 16.4)
- [ ] Desktop Chrome — install prompt
- [ ] Desktop Safari — basic functionality

---

## Package Summary

```bash
# Phase 1 & 2
pnpm add next-pwa --filter web

# Phase 3
pnpm add web-push --filter api
pnpm add -D @types/web-push --filter api
```

## Key File Changes

| File | Change |
|------|--------|
| `apps/web/next.config.js` | Add next-pwa config |
| `apps/web/public/manifest.json` | New |
| `apps/web/public/icons/*` | New icon set |
| `apps/web/public/offline.html` | New fallback page |
| `apps/web/src/app/layout.tsx` | Add PWA meta tags |
| `apps/web/src/components/OfflineBanner.tsx` | New |
| `apps/web/src/components/InstallPrompt.tsx` | New (optional) |
| `apps/web/src/lib/push.ts` | New (Phase 3) |
| `apps/api/src/push/` | New module (Phase 3) |
| `packages/db/prisma/schema.prisma` | Add push_subscriptions (Phase 3) |
