# Settings CRUD — Design

**Date:** 2026-04-06
**Status:** Approved

---

## Goal

Add a singleton `settings` record that stores a named list of tracking symbols. Expose it through a `GET /settings` + `PUT /settings` API and a `/settings` page in the web app where the user can view and edit the record.

---

## Database

New Prisma model in `packages/db/prisma/schema.prisma`:

```prisma
model Settings {
  id               String   @id @default(cuid())
  name             String
  trackingSymbols  Json     @default("[]")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@map("settings")
}
```

- `trackingSymbols` is a JSON column that stores a string array (e.g. `["BTCUSDT", "ETHUSDT"]`).
- Only one row is ever created. The service enforces this via `findFirst()` / `upsert()`.

---

## API

### Module: `apps/api/src/modules/settings/`

**Files:**
- `settings.module.ts` — imports `DatabaseModule`, provides controller + service
- `settings.service.ts` — business logic
- `settings.controller.ts` — HTTP handlers
- `dto/settings.dto.ts` — request body DTOs
- Register `SettingsModule` in `apps/api/src/app.module.ts`

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/settings` | Returns the single settings record, or `null` if none exists |
| `PUT` | `/settings` | Upserts the record — creates on first call, updates on subsequent calls |

### DTOs

```ts
// dto/settings.dto.ts
export class UpsertSettingsDto {
  name: string;
  trackingSymbols: string[];
}
```

### Service methods

```ts
interface SettingsRecord {
  id: string;
  name: string;
  trackingSymbols: string[];
  createdAt: Date;
  updatedAt: Date;
}

get(): Promise<SettingsRecord | null>
upsert(dto: UpsertSettingsDto): Promise<SettingsRecord>
```

`get()` calls `prisma.settings.findFirst()`.

`upsert()` calls `prisma.settings.upsert({ where: { id: existing?.id ?? '' }, create: {...}, update: {...} })` — fetches existing record first to get its `id`, then upserts. If no record exists yet, `id` falls back to empty string which won't match, so Prisma creates a new one.

`trackingSymbols` is cast from `Json` to `string[]` before returning.

---

## Web

### Types (`apps/web/src/shared/api/types.ts`)

```ts
export type TrackingSettings = {
  id: string;
  name: string;
  trackingSymbols: string[];
  createdAt: Date;
};

export type UpsertSettingsInput = {
  name: string;
  trackingSymbols: string[];
};
```

### API Client (`apps/web/src/shared/api/client.ts`)

Two new methods:
- `fetchSettings(): Promise<TrackingSettings | null>` — `GET /settings`
- `upsertSettings(input: UpsertSettingsInput): Promise<TrackingSettings>` — `PUT /settings`

### Page (`apps/web/src/app/settings/page.tsx`)

- Route: `/settings`
- Async server component — fetches current settings, passes to widget
- Falls back to `null` on error

### Widget (`apps/web/src/widgets/settings-feed/`)

**Files:**
- `settings-feed.tsx` — main client component

**Behaviour:**
- Receives `initial: TrackingSettings | null` prop
- Renders a form with:
  - `name` text input
  - `trackingSymbols` multi-value input: text field + "Add" button to append a symbol, × button to remove each symbol
- On load: pre-fills form from `initial` if present, otherwise blank
- On "Save": calls `upsertSettings()`, shows success/error feedback inline
- No delete, no list — single form view

### Sidebar nav (`apps/web/src/widgets/app-shell/sidebar-nav.tsx`)

Add entry: `{ href: '/settings', label: 'Settings' }`

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| `GET /settings` when no record exists | Returns `null` (HTTP 200) |
| `PUT /settings` first call | Creates the record, returns it |
| `PUT /settings` subsequent calls | Updates in place, returns updated record |
| `trackingSymbols` sent as empty array | Stored as `[]`, valid |
| Symbol entered as lowercase | Stored as-is; no normalisation in this feature |

---

## Not In Scope

- Multiple settings records
- Per-symbol metadata (notes, labels)
- Symbol uppercase normalisation
- Integration with WatchlistService (separate feature)
