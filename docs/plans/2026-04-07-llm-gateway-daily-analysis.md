# LLM Gateway And Structured Daily Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a reusable backend LLM gateway with Claude as the first provider, then migrate daily analysis to store full structured AI output plus formatted summary text.

**Architecture:** Introduce a generic backend-owned LLM gateway and provider adapter layer, validate a structured daily-analysis schema, persist the raw structured AI output and provider metadata in `DailyAnalysis`, and keep Telegram/API compatibility through a derived summary formatter.

**Tech Stack:** NestJS, TypeScript, Jest, Prisma, Axios, Zod, pnpm

---

### Task 1: Lock down the new `DailyAnalysis` persistence shape with failing schema and repository tests

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/client.spec.ts`
- Modify: `packages/db/src/repositories/daily-analysis.repository.ts`
- Create: `packages/db/src/repositories/daily-analysis.repository.spec.ts`

**Step 1: Write the failing test**

Add tests asserting `DailyAnalysis` includes:
- `llmProvider`
- `llmModel`
- `aiOutputJson`

and repository create/list calls can round-trip those fields.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/db test -- --runInBand client.spec.ts daily-analysis.repository.spec.ts`
Expected: FAIL because the schema and repository do not include the new fields yet.

**Step 3: Write minimal implementation**

- Extend Prisma schema with the three new fields.
- Update the repository typing and behavior to expose them.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @app/db test -- --runInBand client.spec.ts daily-analysis.repository.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/src/client.spec.ts packages/db/src/repositories/daily-analysis.repository.ts packages/db/src/repositories/daily-analysis.repository.spec.ts
git commit -m "feat: extend daily analysis persistence for llm output"
```

### Task 2: Add a structured daily-analysis schema in core

**Files:**
- Create: `packages/core/src/validation/daily-analysis-plan.schema.ts`
- Create: `packages/core/src/validation/daily-analysis-plan.schema.spec.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Add a schema test proving valid AI output is accepted and normalized, and malformed output is rejected.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/core test -- --runInBand daily-analysis-plan.schema.spec.ts`
Expected: FAIL because the schema file does not exist yet.

**Step 3: Write minimal implementation**

- Add a Zod schema for:
  - `analysis`
  - `bias`
  - `confidence`
  - `tradePlan`
  - `scenarios`
  - `riskNote`
  - `timeHorizon`
- Export it from `packages/core/src/index.ts`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @app/core test -- --runInBand daily-analysis-plan.schema.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/validation/daily-analysis-plan.schema.ts packages/core/src/validation/daily-analysis-plan.schema.spec.ts packages/core/src/index.ts
git commit -m "feat: add structured daily analysis schema"
```

### Task 3: Introduce a backend LLM gateway contract and provider selection

**Files:**
- Create: `apps/worker/src/modules/llm/llm-provider.adapter.ts`
- Create: `apps/worker/src/modules/llm/llm-gateway.service.ts`
- Create: `apps/worker/src/modules/llm/llm-gateway.module.ts`
- Create: `apps/worker/test/llm-gateway.module.spec.ts`
- Modify: `apps/worker/src/modules/llm/llm.module.ts`

**Step 1: Write the failing test**

Add tests asserting:
- generic provider selection defaults to Claude
- unknown provider throws clearly
- gateway resolves and exposes a `generateDailyAnalysisPlan(...)` method

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand llm-gateway.module.spec.ts`
Expected: FAIL because the gateway contract/module does not exist yet.

**Step 3: Write minimal implementation**

- Add a generic adapter interface.
- Add a gateway service that delegates the daily-analysis use case to the selected provider.
- Move provider selection to generic `LLM_PROVIDER`, default `claude`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand llm-gateway.module.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/src/modules/llm apps/worker/test/llm-gateway.module.spec.ts
git commit -m "feat: add backend llm gateway"
```

### Task 4: Make Claude implement the generic provider adapter for structured daily plans

**Files:**
- Modify: `apps/worker/src/modules/llm/claude-daily-analysis.provider.ts`
- Create: `apps/worker/test/claude-daily-analysis.provider.spec.ts`

**Step 1: Write the failing test**

Add tests proving Claude:
- sends a structured daily-analysis prompt
- parses JSON output
- validates the result with the new core schema
- returns provider/model metadata

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts`
Expected: FAIL because the provider still returns plain text summary only.

**Step 3: Write minimal implementation**

- Change Claude daily-analysis provider to return structured plan data.
- Validate provider output before returning it to the gateway.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/src/modules/llm/claude-daily-analysis.provider.ts apps/worker/test/claude-daily-analysis.provider.spec.ts
git commit -m "feat: return structured daily plans from claude provider"
```

### Task 5: Add a Telegram/daily-summary formatter from structured AI output

**Files:**
- Create: `packages/core/src/telegram/format-daily-analysis-plan-message.ts`
- Create: `packages/core/src/telegram/format-daily-analysis-plan-message.spec.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Add a formatting test asserting the structured AI plan becomes a compact Telegram-friendly message.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/core test -- --runInBand format-daily-analysis-plan-message.spec.ts`
Expected: FAIL because the formatter does not exist yet.

**Step 3: Write minimal implementation**

- Format `analysis`, `bias`, `entryZone`, `stopLoss`, `takeProfit`, `invalidation`, and risk/scenario notes into a concise message.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @app/core test -- --runInBand format-daily-analysis-plan-message.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/telegram/format-daily-analysis-plan-message.ts packages/core/src/telegram/format-daily-analysis-plan-message.spec.ts packages/core/src/index.ts
git commit -m "feat: add daily analysis plan formatter"
```

### Task 6: Migrate `DailyAnalysisService` to persist full AI output

**Files:**
- Modify: `apps/worker/src/modules/analysis/daily-analysis.service.ts`
- Modify: `apps/worker/test/daily-analysis.service.spec.ts`
- Modify: `apps/worker/src/modules/analysis/analysis.module.ts`

**Step 1: Write the failing test**

Add tests asserting:
- `DailyAnalysisService` calls the gateway, not a summary-only provider
- repository `create()` stores `llmProvider`, `llmModel`, and `aiOutputJson`
- stored `summary` is derived from the structured AI output formatter

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts`
Expected: FAIL because the service still stores only `summary`.

**Step 3: Write minimal implementation**

- Inject the generic gateway.
- Request structured daily analysis.
- Format summary from that structured output.
- Persist provider/model/raw JSON/summary together.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/src/modules/analysis/daily-analysis.service.ts apps/worker/test/daily-analysis.service.spec.ts apps/worker/src/modules/analysis/analysis.module.ts
git commit -m "feat: persist structured daily analysis output"
```

### Task 7: Extend API daily-analysis types and tests

**Files:**
- Modify: `apps/api/src/modules/daily-analysis/daily-analysis.service.ts`
- Modify: `apps/api/test/daily-analysis.e2e-spec.ts`
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/client.ts`
- Modify: `apps/web/src/app/daily-plan/page.spec.tsx`

**Step 1: Write the failing test**

Add API and mapping tests asserting daily-analysis responses include:
- `llmProvider`
- `llmModel`
- parsed `aiOutput`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- --runInBand daily-analysis.e2e-spec.ts`
Run: `pnpm --filter web test -- --runInBand daily-plan/page.spec.tsx`
Expected: FAIL because the response types do not include structured AI output yet.

**Step 3: Write minimal implementation**

- Extend API record typing.
- Update the web API client mapping.
- Keep UI behavior compatible even if it still renders summary-first.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- --runInBand daily-analysis.e2e-spec.ts`
Run: `pnpm --filter web test -- --runInBand daily-plan/page.spec.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/modules/daily-analysis/daily-analysis.service.ts apps/api/test/daily-analysis.e2e-spec.ts apps/web/src/shared/api/types.ts apps/web/src/shared/api/client.ts apps/web/src/app/daily-plan/page.spec.tsx
git commit -m "feat: expose structured daily analysis through api"
```

### Task 8: Update docs, env, and run final verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Test: `apps/worker/test/*`
- Test: `apps/api/test/daily-analysis.e2e-spec.ts`
- Test: `apps/web/src/app/daily-plan/page.spec.tsx`

**Step 1: Update documentation**

- Replace daily-analysis specific env selection with generic gateway config such as `LLM_PROVIDER`.
- Document Claude model selection and future provider intent.
- Explain that web features should call backend, not provider APIs directly.

**Step 2: Run targeted verification**

Run: `pnpm --filter @app/db test -- --runInBand client.spec.ts daily-analysis.repository.spec.ts`
Run: `pnpm --filter @app/core test -- --runInBand daily-analysis-plan.schema.spec.ts format-daily-analysis-plan-message.spec.ts`
Run: `pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts llm-gateway.module.spec.ts claude-daily-analysis.provider.spec.ts worker-bootstrap.spec.ts`
Run: `pnpm --filter api test -- --runInBand daily-analysis.e2e-spec.ts`
Run: `pnpm --filter web test -- --runInBand daily-plan/page.spec.tsx`

Expected: PASS

**Step 3: Run type verification**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Optional migration verification**

Run: `pnpm prisma:generate`
Expected: PASS

**Step 5: Commit**

```bash
git add .env.example README.md packages apps
git commit -m "feat: add reusable llm gateway for structured daily analysis"
```
