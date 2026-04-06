# Settings CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a singleton `settings` record that stores a name and a list of tracking symbols, exposed via `GET /settings` + `PUT /settings` and a `/settings` page in the web app.

**Architecture:** Prisma `Settings` model with a `Json` column for `trackingSymbols`. The API module follows the existing controller → service → repository pattern. The web page is a server component that fetches data and passes it to a `'use client'` form widget.

**Tech Stack:** NestJS, Prisma, MySQL, Next.js App Router, TypeScript, Jest

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `packages/db/prisma/schema.prisma` | Add `Settings` model |
| Create | `packages/db/src/repositories/settings.repository.ts` | `findFirst` + `upsert` |
| Modify | `packages/db/src/index.ts` | Export `createSettingsRepository` |
| Modify | `apps/api/src/modules/database/database.providers.ts` | Add `SETTINGS_REPOSITORY` provider |
| Create | `apps/api/src/modules/settings/dto/upsert-settings.dto.ts` | Request body DTO |
| Create | `apps/api/src/modules/settings/settings.service.ts` | `get()` and `upsert()` |
| Create | `apps/api/test/settings.service.spec.ts` | Unit tests for service |
| Create | `apps/api/src/modules/settings/settings.controller.ts` | `GET /settings`, `PUT /settings` |
| Create | `apps/api/src/modules/settings/settings.module.ts` | NestJS module |
| Modify | `apps/api/src/app.module.ts` | Register `SettingsModule` |
| Modify | `apps/web/src/shared/api/types.ts` | Add `TrackingSettings`, `UpsertSettingsInput` |
| Modify | `apps/web/src/shared/api/client.ts` | Add `fetchSettings`, `upsertSettings` |
| Create | `apps/web/src/widgets/settings-feed/settings-feed.tsx` | Form widget (client component) |
| Create | `apps/web/src/_pages/settings-page/settings-page.tsx` | Async server page component |
| Create | `apps/web/src/app/settings/page.tsx` | Next.js route re-export |
| Create | `apps/web/src/app/settings/page.spec.tsx` | Page tests |
| Modify | `apps/web/src/widgets/app-shell/sidebar-nav.tsx` | Add Settings nav item |

---

## Task 1: DB — Add Settings model and repository

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/repositories/settings.repository.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add Settings model to schema**

In `packages/db/prisma/schema.prisma`, append after the `DailyAnalysis` model:

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

- [ ] **Step 2: Run migration**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis && pnpm --filter @app/db exec prisma migrate dev --name add-settings
```

Expected: migration file created, `settings` table created in the database.

- [ ] **Step 3: Create the repository**

Create `packages/db/src/repositories/settings.repository.ts`:

```ts
import { prisma } from '../client';

export function createSettingsRepository(client = prisma) {
  return {
    findFirst() {
      return client.settings.findFirst();
    },
    upsert(data: { name: string; trackingSymbols: string[] }) {
      return client.settings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', name: data.name, trackingSymbols: data.trackingSymbols },
        update: { name: data.name, trackingSymbols: data.trackingSymbols }
      });
    }
  };
}
```

- [ ] **Step 4: Export from index**

In `packages/db/src/index.ts`, add the new export:

```ts
export { prisma } from './client';
export { createAnalysisRunRepository } from './repositories/analysis-run.repository';
export { createOrderRepository } from './repositories/order.repository';
export { createSignalRepository } from './repositories/signal.repository';
export { createTelegramMessageLogRepository } from './repositories/telegram-message-log.repository';
export { createDailyAnalysisRepository } from './repositories/daily-analysis.repository';
export { createSettingsRepository } from './repositories/settings.repository';
```

- [ ] **Step 5: Verify the Prisma client has the new model**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis && pnpm --filter @app/db exec prisma generate
```

Expected: client regenerated with `settings` model.

- [ ] **Step 6: Commit**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis && git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/repositories/settings.repository.ts packages/db/src/index.ts && git commit -m "feat: add Settings model and repository"
```

---

## Task 2: API — SettingsModule

**Files:**
- Modify: `apps/api/src/modules/database/database.providers.ts`
- Create: `apps/api/src/modules/settings/dto/upsert-settings.dto.ts`
- Create: `apps/api/src/modules/settings/settings.service.ts`
- Create: `apps/api/test/settings.service.spec.ts`
- Create: `apps/api/src/modules/settings/settings.controller.ts`
- Create: `apps/api/src/modules/settings/settings.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write failing service tests**

Create `apps/api/test/settings.service.spec.ts`:

```ts
import { SettingsService } from '../src/modules/settings/settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let mockRepo: { findFirst: jest.Mock; upsert: jest.Mock };

  beforeEach(() => {
    mockRepo = { findFirst: jest.fn(), upsert: jest.fn() };
    service = new SettingsService(mockRepo as never);
  });

  describe('get', () => {
    it('returns null when no settings record exists', async () => {
      mockRepo.findFirst.mockResolvedValue(null);
      expect(await service.get()).toBeNull();
    });

    it('returns mapped record with trackingSymbols as string array', async () => {
      mockRepo.findFirst.mockResolvedValue({
        id: 'singleton',
        name: 'My Watchlist',
        trackingSymbols: ['BTCUSDT', 'ETHUSDT'],
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01')
      });
      const result = await service.get();
      expect(result?.name).toBe('My Watchlist');
      expect(result?.trackingSymbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    });

    it('returns empty array when trackingSymbols is not an array', async () => {
      mockRepo.findFirst.mockResolvedValue({
        id: 'singleton',
        name: 'X',
        trackingSymbols: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const result = await service.get();
      expect(result?.trackingSymbols).toEqual([]);
    });
  });

  describe('upsert', () => {
    it('returns the upserted record with correct fields', async () => {
      mockRepo.upsert.mockResolvedValue({
        id: 'singleton',
        name: 'Updated',
        trackingSymbols: ['BTCUSDT'],
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02')
      });
      const result = await service.upsert({ name: 'Updated', trackingSymbols: ['BTCUSDT'] });
      expect(result.name).toBe('Updated');
      expect(result.trackingSymbols).toEqual(['BTCUSDT']);
    });

    it('calls repo.upsert with the provided data', async () => {
      mockRepo.upsert.mockResolvedValue({
        id: 'singleton',
        name: 'Test',
        trackingSymbols: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await service.upsert({ name: 'Test', trackingSymbols: [] });
      expect(mockRepo.upsert).toHaveBeenCalledWith({ name: 'Test', trackingSymbols: [] });
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis/apps/api && pnpm test -- --testPathPatterns=settings.service
```

Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Create the DTO**

Create `apps/api/src/modules/settings/dto/upsert-settings.dto.ts`:

```ts
export class UpsertSettingsDto {
  name!: string;
  trackingSymbols!: string[];
}
```

- [ ] **Step 4: Create the service**

Create `apps/api/src/modules/settings/settings.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createSettingsRepository } from '@app/db';

import { SETTINGS_REPOSITORY } from '../database/database.providers';

type SettingsRepository = ReturnType<typeof createSettingsRepository>;

export type SettingsRecord = {
  id: string;
  name: string;
  trackingSymbols: string[];
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SettingsService {
  constructor(
    @Inject(SETTINGS_REPOSITORY)
    private readonly settingsRepository: SettingsRepository
  ) {}

  async get(): Promise<SettingsRecord | null> {
    const row = await this.settingsRepository.findFirst();
    if (!row) return null;
    return {
      ...row,
      trackingSymbols: Array.isArray(row.trackingSymbols) ? (row.trackingSymbols as string[]) : []
    };
  }

  async upsert(dto: { name: string; trackingSymbols: string[] }): Promise<SettingsRecord> {
    const row = await this.settingsRepository.upsert(dto);
    return {
      ...row,
      trackingSymbols: Array.isArray(row.trackingSymbols) ? (row.trackingSymbols as string[]) : []
    };
  }
}
```

- [ ] **Step 5: Run tests to confirm passing**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis/apps/api && pnpm test -- --testPathPatterns=settings.service
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Create the controller**

Create `apps/api/src/modules/settings/settings.controller.ts`:

```ts
import { Body, Controller, Get, Inject, Put } from '@nestjs/common';

import type { SettingsRecord } from './settings.service';
import { SettingsService } from './settings.service';
import { UpsertSettingsDto } from './dto/upsert-settings.dto';

@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService)
    private readonly settingsService: SettingsService
  ) {}

  @Get()
  get(): Promise<SettingsRecord | null> {
    return this.settingsService.get();
  }

  @Put()
  upsert(@Body() body: UpsertSettingsDto): Promise<SettingsRecord> {
    return this.settingsService.upsert(body);
  }
}
```

- [ ] **Step 7: Create the module**

Create `apps/api/src/modules/settings/settings.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SettingsController],
  providers: [SettingsService]
})
export class SettingsModule {}
```

- [ ] **Step 8: Register the repository provider**

In `apps/api/src/modules/database/database.providers.ts`, add the import and symbol, then add the provider entry:

```ts
import type { Provider } from '@nestjs/common';
import {
  createAnalysisRunRepository,
  createDailyAnalysisRepository,
  createOrderRepository,
  createSettingsRepository,
  createSignalRepository,
  createTelegramMessageLogRepository,
  prisma
} from '@app/db';

export const ANALYSIS_RUN_REPOSITORY = Symbol('ANALYSIS_RUN_REPOSITORY');
export const DAILY_ANALYSIS_REPOSITORY = Symbol('DAILY_ANALYSIS_REPOSITORY');
export const SIGNAL_REPOSITORY = Symbol('SIGNAL_REPOSITORY');
export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
export const TELEGRAM_LOG_REPOSITORY = Symbol('TELEGRAM_LOG_REPOSITORY');
export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');

export const DatabaseProviders: Provider[] = [
  {
    provide: 'PRISMA_CLIENT',
    useValue: prisma
  },
  {
    provide: ANALYSIS_RUN_REPOSITORY,
    useFactory: () => createAnalysisRunRepository()
  },
  {
    provide: DAILY_ANALYSIS_REPOSITORY,
    useFactory: () => createDailyAnalysisRepository()
  },
  {
    provide: SIGNAL_REPOSITORY,
    useFactory: () => createSignalRepository()
  },
  {
    provide: ORDER_REPOSITORY,
    useFactory: () => createOrderRepository()
  },
  {
    provide: TELEGRAM_LOG_REPOSITORY,
    useFactory: () => createTelegramMessageLogRepository()
  },
  {
    provide: SETTINGS_REPOSITORY,
    useFactory: () => createSettingsRepository()
  }
];
```

- [ ] **Step 9: Register SettingsModule in AppModule**

Replace the content of `apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { ChatModule } from './modules/chat/chat.module';
import { DailyAnalysisModule } from './modules/daily-analysis/daily-analysis.module';
import { HealthModule } from './modules/health/health.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SignalsModule } from './modules/signals/signals.module';
import { TelegramLogsModule } from './modules/telegram-logs/telegram-logs.module';
import { WorkerModule } from './modules/worker/worker.module';

@Module({
  imports: [HealthModule, AnalysisModule, ChatModule, SignalsModule, OrdersModule, TelegramLogsModule, WorkerModule, DailyAnalysisModule, SettingsModule]
})
export class AppModule {}
```

- [ ] **Step 10: Build to verify no TypeScript errors**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis/apps/api && pnpm build
```

Expected: clean build, no errors.

- [ ] **Step 11: Commit**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis && git add apps/api/src/modules/settings apps/api/test/settings.service.spec.ts apps/api/src/modules/database/database.providers.ts apps/api/src/app.module.ts && git commit -m "feat: add SettingsModule with GET /settings and PUT /settings"
```

---

## Task 3: Web — Settings page

**Files:**
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/client.ts`
- Create: `apps/web/src/widgets/settings-feed/settings-feed.tsx`
- Create: `apps/web/src/_pages/settings-page/settings-page.tsx`
- Create: `apps/web/src/app/settings/page.tsx`
- Create: `apps/web/src/app/settings/page.spec.tsx`
- Modify: `apps/web/src/widgets/app-shell/sidebar-nav.tsx`

- [ ] **Step 1: Add types**

In `apps/web/src/shared/api/types.ts`, append at the end:

```ts
export type TrackingSettings = {
  id: string;
  name: string;
  trackingSymbols: string[];
  createdAt: string;
  updatedAt: string;
};

export type UpsertSettingsInput = {
  name: string;
  trackingSymbols: string[];
};
```

- [ ] **Step 2: Add client methods**

In `apps/web/src/shared/api/client.ts`:

First, add the new types to the import at the top:

```ts
import type {
  CloseDashboardOrderInput,
  CreateDashboardOrderInput,
  DailyAnalysis,
  DashboardAnalysisRun,
  DashboardHealth,
  DashboardOrder,
  DashboardSignal,
  TrackingSettings,
  UpsertSettingsInput
} from './types';
```

Then add this mapper function after `mapDailyAnalysis`:

```ts
function mapSettings(row: JsonRecord): TrackingSettings {
  const symbols = Array.isArray(row.trackingSymbols)
    ? (row.trackingSymbols as unknown[]).map(String)
    : [];
  return {
    id: String(row.id),
    name: String(row.name),
    trackingSymbols: symbols,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}
```

Then add these two methods inside the `createApiClient` return object, after `closeOrder`:

```ts
    async fetchSettings(): Promise<TrackingSettings | null> {
      const row = await fetchJson<JsonRecord | null>(fetchImpl, `${baseUrl}/settings`);
      return row ? mapSettings(row) : null;
    },
    async upsertSettings(input: UpsertSettingsInput): Promise<TrackingSettings> {
      const response = await fetchImpl(`${baseUrl}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        throw new Error(`Request failed for ${baseUrl}/settings: ${response.status}`);
      }
      return mapSettings((await response.json()) as JsonRecord);
    }
```

- [ ] **Step 3: Write failing page tests**

Create `apps/web/src/app/settings/page.spec.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';

import { createApiClient } from '@web/shared/api/client';
import SettingsPage from './page';

jest.mock('@web/shared/api/client', () => ({
  createApiClient: jest.fn()
}));

const mockedCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

const mockSettings = {
  id: 'singleton',
  name: 'My Watchlist',
  trackingSymbols: ['BTCUSDT', 'ETHUSDT'],
  createdAt: '2026-04-06T00:00:00.000Z',
  updatedAt: '2026-04-06T00:00:00.000Z'
};

describe('SettingsPage', () => {
  beforeEach(() => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [],
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      fetchDailyAnalysis: async () => [],
      createOrder: async () => { throw new Error('not used'); },
      closeOrder: async () => { throw new Error('not used'); },
      fetchSettings: async () => mockSettings,
      upsertSettings: async () => mockSettings
    } as ReturnType<typeof createApiClient>);
  });

  it('renders the settings page with heading', async () => {
    const markup = renderToStaticMarkup(await SettingsPage());
    expect(markup).toContain('Tracking Settings');
    expect(markup).toContain('Settings');
  });

  it('renders with initial settings data', async () => {
    const markup = renderToStaticMarkup(await SettingsPage());
    expect(markup).toContain('My Watchlist');
    expect(markup).toContain('BTCUSDT');
    expect(markup).toContain('ETHUSDT');
  });

  it('renders empty form when no settings exist', async () => {
    mockedCreateApiClient.mockReturnValue({
      baseUrl: 'http://localhost:3000',
      fetchOrders: async () => [],
      fetchSignals: async () => [],
      fetchAnalysisRuns: async () => [],
      fetchHealth: async () => ({ service: 'api', status: 'ok' }),
      fetchDailyAnalysis: async () => [],
      createOrder: async () => { throw new Error('not used'); },
      closeOrder: async () => { throw new Error('not used'); },
      fetchSettings: async () => null,
      upsertSettings: async () => { throw new Error('not used'); }
    } as ReturnType<typeof createApiClient>);

    const markup = renderToStaticMarkup(await SettingsPage());
    expect(markup).toContain('Tracking Settings');
  });
});
```

- [ ] **Step 4: Run to confirm failure**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis/apps/web && pnpm test -- --testPathPatterns=settings/page
```

Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 5: Create the settings widget**

Create `apps/web/src/widgets/settings-feed/settings-feed.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { TrackingSettings } from '@web/shared/api/types';

type SettingsFeedProps = Readonly<{
  initial: TrackingSettings | null;
}>;

export function SettingsFeed({ initial }: SettingsFeedProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [symbols, setSymbols] = useState<string[]>(initial?.trackingSymbols ?? []);
  const [symbolInput, setSymbolInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  function handleAddSymbol() {
    const trimmed = symbolInput.trim().toUpperCase();
    if (!trimmed || symbols.includes(trimmed)) return;
    setSymbols([...symbols, trimmed]);
    setSymbolInput('');
  }

  function handleRemoveSymbol(index: number) {
    setSymbols(symbols.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setStatus('saving');
    try {
      const client = createApiClient();
      await client.upsertSettings({ name, trackingSymbols: symbols });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <main className="dashboard-shell settings-shell">
      <section className="hero-card settings-hero">
        <div className="hero-copy">
          <p className="eyebrow">Settings</p>
          <h1>Tracking Settings</h1>
          <p className="lead">Configure the symbols you want to track continuously.</p>
        </div>
      </section>

      <section className="settings-form">
        <div className="settings-field">
          <label htmlFor="settings-name" className="settings-label">Name</label>
          <input
            id="settings-name"
            className="settings-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My Watchlist"
          />
        </div>

        <div className="settings-field">
          <label className="settings-label">Tracking Symbols</label>
          <div className="settings-symbol-list">
            {symbols.map((sym, i) => (
              <span key={sym} className="settings-symbol-tag">
                {sym}
                <button
                  className="settings-symbol-remove"
                  onClick={() => handleRemoveSymbol(i)}
                  aria-label={`Remove ${sym}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="settings-symbol-add">
            <input
              className="settings-input"
              type="text"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddSymbol(); }}
              placeholder="e.g. BTCUSDT"
            />
            <button className="btn btn--secondary" onClick={handleAddSymbol}>Add</button>
          </div>
        </div>

        <div className="settings-actions">
          <button
            className="btn btn--primary"
            onClick={() => { void handleSave(); }}
            disabled={status === 'saving'}
          >
            {status === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {status === 'saved' && <span className="settings-status settings-status--success">Saved</span>}
          {status === 'error' && <span className="settings-status settings-status--error">Failed to save</span>}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Create the page component**

Create `apps/web/src/_pages/settings-page/settings-page.tsx`:

```tsx
import { createApiClient } from '@web/shared/api/client';
import type { TrackingSettings } from '@web/shared/api/types';
import { SettingsFeed } from '@web/widgets/settings-feed/settings-feed';

async function loadSettings(): Promise<TrackingSettings | null> {
  const client = createApiClient();
  try {
    return await client.fetchSettings();
  } catch {
    return null;
  }
}

export default async function SettingsPage() {
  const settings = await loadSettings();
  return <SettingsFeed initial={settings} />;
}
```

- [ ] **Step 7: Create the Next.js route**

Create `apps/web/src/app/settings/page.tsx`:

```tsx
export { default } from '@web/_pages/settings-page/settings-page';
```

- [ ] **Step 8: Run tests to confirm passing**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis/apps/web && pnpm test -- --testPathPatterns=settings/page
```

Expected: all 3 tests PASS.

- [ ] **Step 9: Add Settings to sidebar nav**

In `apps/web/src/widgets/app-shell/sidebar-nav.tsx`, update the `NAV_ITEMS` array:

```ts
const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Overview',
    description: 'Dashboard summary'
  },
  {
    href: '/trades',
    label: 'Trading History',
    description: 'Manual orders'
  },
  {
    href: '/analysis',
    label: 'Analysis Feed',
    description: 'Worker signals'
  },
  {
    href: '/daily-plan',
    label: 'Daily Plan',
    description: 'BTC daily analysis'
  },
  {
    href: '/settings',
    label: 'Settings',
    description: 'Tracking symbol configuration'
  }
];
```

- [ ] **Step 10: Run all web tests**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis/apps/web && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 11: Build to verify no TypeScript errors**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis/apps/web && pnpm build
```

Expected: clean build, no errors.

- [ ] **Step 12: Commit**

```bash
cd /Users/dnhieu92/Documents/personal/new-account/market-analysis && git add apps/web/src/shared/api/types.ts apps/web/src/shared/api/client.ts apps/web/src/widgets/settings-feed/settings-feed.tsx apps/web/src/_pages/settings-page/settings-page.tsx apps/web/src/app/settings/page.tsx apps/web/src/app/settings/page.spec.tsx apps/web/src/widgets/app-shell/sidebar-nav.tsx && git commit -m "feat: add /settings page with tracking symbol form"
```
