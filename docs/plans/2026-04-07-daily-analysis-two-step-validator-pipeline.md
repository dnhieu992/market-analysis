# Daily Analysis Two-Step Validator Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current one-step daily-analysis generation with the two-step Analyst -> Validator pipeline described in [`docs/llm-trading-prompts.md`](/Users/dnhieu92/Documents/personal/new-account/market-analysis/docs/llm-trading-prompts.md), plus backend hard checks and safe publish fallbacks.

**Architecture:** The worker will build a structured `market_data` JSON payload from D1 + H4 candles and indicators, send it to an Analyst prompt, send the draft to a Validator prompt, run deterministic hard checks in code, and publish only a validated final plan or a safe `WAIT`/`NO_TRADE` fallback. The published plan will become the persisted `aiOutput`, while a separate debug payload will store `market_data`, Analyst output, Validator output, and hard-check results for inspection.

**Tech Stack:** NestJS worker/API, Prisma + MySQL, Zod schemas, Jest, shared contracts in `packages/core`

**Assumptions:**
- Keep the current business decision: `bias_frame = D1`, `setup_frame = H4`, and `entry_refinement_frame = "none"` for now.
- Increase candle history from 100 to 200 for D1/H4 to align with the prompt spec.
- Claude remains the first provider, but the gateway contract must support future OpenAI/Gemini providers.
- `WAIT` and `NO_TRADE` are valid first-class outputs and must be published without trying to force a setup.

---

### Task 1: Define The New Daily-Analysis Contracts

**Files:**
- Create: `packages/core/src/validation/daily-analysis-market-data.schema.ts`
- Create: `packages/core/src/validation/daily-analysis-analyst-draft.schema.ts`
- Create: `packages/core/src/validation/daily-analysis-validator-result.schema.ts`
- Modify: `packages/core/src/validation/daily-analysis-plan.schema.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/validation/daily-analysis-market-data.schema.spec.ts`
- Test: `packages/core/src/validation/daily-analysis-analyst-draft.schema.spec.ts`
- Test: `packages/core/src/validation/daily-analysis-validator-result.schema.spec.ts`
- Test: `packages/core/src/validation/daily-analysis-plan.schema.spec.ts`

**Step 1: Write the failing schema tests**

Add tests that expect these contracts to exist:

```ts
dailyAnalysisMarketDataSchema.parse({
  symbol: 'BTCUSDT',
  exchange: 'Binance',
  timestamp: '2026-04-07T20:30:00+07:00',
  currentPrice: 68395.2,
  session: 'Asia',
  strategyProfile: {
    biasFrame: 'D1',
    setupFrame: 'H4',
    entryRefinementFrame: 'none',
    strategyType: 'breakout_following',
    allowNoTrade: true,
    minimumRr: 1.5,
    preferredBreakoutRr: 2,
    avoidScalpingLogic: true
  }
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @app/core test -- --runInBand daily-analysis-market-data.schema.spec.ts daily-analysis-analyst-draft.schema.spec.ts daily-analysis-validator-result.schema.spec.ts daily-analysis-plan.schema.spec.ts
```

Expected: FAIL because the new schemas and/or updated plan contract do not exist yet.

**Step 3: Implement the schemas**

Create the new Zod contracts with these core shapes:

```ts
export const dailyAnalysisAnalystDraftSchema = z.object({
  summary: z.string().min(1),
  bias: z.enum(['Bullish', 'Bearish', 'Neutral']),
  confidence: z.number().min(0).max(100),
  status: z.enum(['TRADE_READY', 'WAIT', 'NO_TRADE']),
  timeframeContext: z.object({
    biasFrame: z.string(),
    setupFrame: z.string(),
    entryRefinementFrame: z.string(),
    higherTimeframeView: z.string(),
    setupTimeframeView: z.string(),
    alignment: z.enum(['aligned', 'conflicting', 'neutral'])
  }),
  marketState: z.object({
    trendCondition: z.enum(['trending', 'ranging', 'compressed', 'transitional']),
    volumeCondition: z.enum(['strong', 'normal', 'weak', 'very_weak']),
    volatilityCondition: z.enum(['high', 'normal', 'low']),
    keyObservation: z.string()
  }),
  setupType: z.enum(['breakout', 'pullback', 'range', 'no-trade']),
  noTradeZone: z.string(),
  primarySetup: z.object({
    direction: z.enum(['long', 'short', 'none']),
    trigger: z.string(),
    entry: z.string(),
    stopLoss: z.string(),
    takeProfit1: z.string(),
    takeProfit2: z.string(),
    riskReward: z.string(),
    invalidation: z.string()
  }),
  secondarySetup: z.object({
    direction: z.enum(['long', 'short', 'none']),
    trigger: z.string(),
    entry: z.string(),
    stopLoss: z.string(),
    takeProfit1: z.string(),
    takeProfit2: z.string(),
    riskReward: z.string(),
    invalidation: z.string()
  }),
  atrConsistencyCheck: z.object({
    result: z.enum(['PASS', 'FAIL', 'WARNING']),
    details: z.string()
  }),
  logicConsistencyCheck: z.object({
    result: z.enum(['PASS', 'FAIL', 'WARNING']),
    details: z.string()
  }),
  reasoning: z.array(z.string().min(1)).min(1),
  finalAction: z.string().min(1)
});
```

Update `daily-analysis-plan.schema.ts` to represent the final published plan, not the old lightweight summary-only structure.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @app/core test -- --runInBand daily-analysis-market-data.schema.spec.ts daily-analysis-analyst-draft.schema.spec.ts daily-analysis-validator-result.schema.spec.ts daily-analysis-plan.schema.spec.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/validation packages/core/src/index.ts
git commit -m "feat: define two-step daily analysis schemas"
```

### Task 2: Build The Structured `market_data` Payload From D1/H4 Inputs

**Files:**
- Create: `apps/worker/src/modules/analysis/daily-analysis-market-data.builder.ts`
- Modify: `apps/worker/src/modules/analysis/daily-analysis.service.ts`
- Test: `apps/worker/test/daily-analysis-market-data.builder.spec.ts`
- Test: `apps/worker/test/daily-analysis.service.spec.ts`

**Step 1: Write the failing builder tests**

Add tests that require:
- 200 candles fetched for D1 and H4
- `strategyProfile` emitted with `biasFrame = 'D1'`, `setupFrame = 'H4'`, `entryRefinementFrame = 'none'`
- candle history included under `timeframes.D1.ohlcv` and `timeframes.H4.ohlcv`
- `marketFlags` derived from volatility/volume context

Example expectation:

```ts
expect(buildDailyAnalysisMarketData(...)).toEqual(
  expect.objectContaining({
    symbol: 'BTCUSDT',
    exchange: 'Binance',
    strategyProfile: expect.objectContaining({
      biasFrame: 'D1',
      setupFrame: 'H4',
      entryRefinementFrame: 'none',
      strategyType: 'breakout_following'
    }),
    timeframes: expect.objectContaining({
      D1: expect.objectContaining({ ohlcv: expect.any(Array) }),
      H4: expect.objectContaining({ ohlcv: expect.any(Array) })
    })
  })
);
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter worker test -- --runInBand daily-analysis-market-data.builder.spec.ts daily-analysis.service.spec.ts
```

Expected: FAIL because the builder and updated service flow do not exist yet.

**Step 3: Implement the builder**

Create a small pure builder with a signature like:

```ts
export function buildDailyAnalysisMarketData(input: {
  symbol: string;
  date: Date;
  currentPrice: number;
  d1Candles: Candle[];
  h4Candles: Candle[];
  d1: TimeframeAnalysis;
  h4: TimeframeAnalysis;
  h4Indicators: IndicatorSnapshot;
}): DailyAnalysisMarketData
```

Update `DailyAnalysisService.analyze()` to:
- fetch D1/H4 candles with limit `200`
- compute current price from the latest H4 close
- call the new builder before invoking the LLM gateway

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter worker test -- --runInBand daily-analysis-market-data.builder.spec.ts daily-analysis.service.spec.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/modules/analysis apps/worker/test/daily-analysis-market-data.builder.spec.ts apps/worker/test/daily-analysis.service.spec.ts
git commit -m "feat: build structured market data for daily analysis"
```

### Task 3: Expand The LLM Gateway To Run Analyst Then Validator

**Files:**
- Modify: `apps/worker/src/modules/llm/llm-provider.adapter.ts`
- Modify: `apps/worker/src/modules/llm/llm-gateway.service.ts`
- Modify: `apps/worker/src/modules/llm/llm-gateway.module.ts`
- Modify: `apps/worker/src/modules/llm/claude-daily-analysis.provider.ts`
- Create: `apps/worker/src/modules/llm/daily-analysis-prompts.ts`
- Test: `apps/worker/test/claude-daily-analysis.provider.spec.ts`
- Test: `apps/worker/test/llm-gateway.module.spec.ts`

**Step 1: Write the failing gateway/provider tests**

Add tests that require:
- `LlmGatewayService` to request an Analyst draft first
- the same provider to validate that draft
- both outputs to be validated against their Zod schemas
- provider requests to use separate prompt templates for Analyst and Validator

Example adapter shape:

```ts
export interface LlmProviderAdapter {
  generateDailyAnalysisDraft(input: DailyAnalysisMarketData): Promise<DailyAnalysisAnalystDraft>;
  validateDailyAnalysisDraft(input: {
    marketData: DailyAnalysisMarketData;
    draftPlan: DailyAnalysisAnalystDraft;
  }): Promise<DailyAnalysisValidatorResult>;
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts llm-gateway.module.spec.ts
```

Expected: FAIL because the gateway/provider are still one-step only.

**Step 3: Implement the two-step provider flow**

Add two prompt builders in `daily-analysis-prompts.ts`:

```ts
export function buildDailyAnalysisAnalystPrompt(marketData: DailyAnalysisMarketData): string;
export function buildDailyAnalysisValidatorPrompt(input: {
  marketData: DailyAnalysisMarketData;
  draftPlan: DailyAnalysisAnalystDraft;
}): string;
```

Refactor the gateway to orchestrate:
1. `draftPlan = provider.generateDailyAnalysisDraft(marketData)`
2. `validatorResult = provider.validateDailyAnalysisDraft({ marketData, draftPlan })`

Refactor `ClaudeDailyAnalysisProvider` to expose those two methods and use structured tool output for both schemas.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts llm-gateway.module.spec.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/modules/llm apps/worker/test/claude-daily-analysis.provider.spec.ts apps/worker/test/llm-gateway.module.spec.ts
git commit -m "feat: add analyst validator llm pipeline"
```

### Task 4: Add Backend Hard Checks And Publish-Gate Logic

**Files:**
- Create: `packages/core/src/validation/daily-analysis-hard-checks.ts`
- Create: `packages/core/src/validation/daily-analysis-hard-checks.spec.ts`
- Create: `apps/worker/src/modules/analysis/publish-daily-analysis-plan.ts`
- Create: `apps/worker/test/publish-daily-analysis-plan.spec.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/worker/src/modules/analysis/daily-analysis.service.ts`

**Step 1: Write the failing hard-check and publish tests**

Add tests that require:
- RR rejection when `RR < minimum_rr`
- breakout long rejection when `TP1 <= breakout level`
- breakout short rejection when `TP1 >= breakdown level`
- ATR warning/fail when TP is too small for H4 breakout logic
- automatic downgrade to `WAIT` when validator rejects or when `weak volume + timeframe conflict`

Example deterministic helper:

```ts
const outcome = runDailyAnalysisHardChecks({
  strategyType: 'breakout_following',
  minimumRr: 1.5,
  breakoutLevel: 68653.38,
  entry: 68680,
  stopLoss: 68110.55,
  takeProfit1: 68640,
  atrSetupFrame: 912.08
});

expect(outcome.valid).toBe(false);
expect(outcome.issues).toContain('TP1 is at or below breakout level for a breakout long setup.');
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @app/core test -- --runInBand daily-analysis-hard-checks.spec.ts
pnpm --filter worker test -- --runInBand publish-daily-analysis-plan.spec.ts
```

Expected: FAIL because no deterministic hard-check/publish gate exists yet.

**Step 3: Implement hard checks and publishing**

Create a hard-check helper in `packages/core` that returns:

```ts
type DailyAnalysisHardCheckResult = {
  valid: boolean;
  issues: string[];
  warnings: string[];
  derivedStatus: 'TRADE_READY' | 'WAIT' | 'NO_TRADE';
};
```

Create `publish-daily-analysis-plan.ts` that merges:
- market data
- Analyst draft
- Validator output
- hard-check outcome

and returns:
- final published plan
- safe fallback when rejected
- debug bundle for storage/logging

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @app/core test -- --runInBand daily-analysis-hard-checks.spec.ts
pnpm --filter worker test -- --runInBand publish-daily-analysis-plan.spec.ts daily-analysis.service.spec.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/validation packages/core/src/index.ts apps/worker/src/modules/analysis apps/worker/test/publish-daily-analysis-plan.spec.ts apps/worker/test/daily-analysis.service.spec.ts
git commit -m "feat: add daily analysis publish gate and hard checks"
```

### Task 5: Persist Final Plan And Debug Payload, Then Update API/Web Contracts

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_expand_daily_analysis_pipeline_fields/migration.sql`
- Test: `packages/db/src/repositories/daily-analysis.repository.spec.ts`
- Modify: `apps/api/src/modules/daily-analysis/daily-analysis.service.ts`
- Modify: `apps/api/test/daily-analysis.e2e-spec.ts`
- Modify: `apps/api/test/stubs/app-db.ts`
- Modify: `apps/web/src/shared/api/types.ts`
- Modify: `apps/web/src/shared/api/client.ts`
- Modify: `apps/web/src/app/daily-plan/page.spec.tsx`

**Step 1: Write the failing persistence/API tests**

Add tests that require:
- `DailyAnalysis.status` to be queryable
- `pipelineDebugJson` to be stored
- API to expose the richer published `aiOutput`
- web client to parse the richer shape

Recommended schema additions:

```prisma
model DailyAnalysis {
  ...
  status            String
  pipelineDebugJson String? @db.LongText
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @app/db test -- --runInBand daily-analysis.repository.spec.ts client.spec.ts
pnpm --filter api test -- --runInBand daily-analysis.e2e-spec.ts
pnpm --filter web test -- --runInBand daily-plan/page.spec.tsx client.spec.ts
```

Expected: FAIL because DB/API/web still expect the old minimal plan contract.

**Step 3: Implement the persistence and contract changes**

Persist:
- `status`
- final published plan in `aiOutputJson`
- full debug bundle in `pipelineDebugJson`
- formatted `summary`

Update API/web types to match the new published-plan schema:

```ts
type DailyAnalysis = {
  aiOutput: DailyAnalysisPlan;
  status: 'TRADE_READY' | 'WAIT' | 'NO_TRADE';
  summary: string;
  ...
};
```

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @app/db test -- --runInBand daily-analysis.repository.spec.ts client.spec.ts
pnpm --filter api test -- --runInBand daily-analysis.e2e-spec.ts
pnpm --filter web test -- --runInBand daily-plan/page.spec.tsx client.spec.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/db apps/api apps/web
git commit -m "feat: persist validated daily analysis pipeline output"
```

### Task 6: Rebuild The Human-Readable Daily Plan Formatter

**Files:**
- Modify: `packages/core/src/telegram/format-daily-analysis-plan-message.ts`
- Modify: `packages/core/src/telegram/format-daily-analysis-plan-message.spec.ts`
- Modify: `apps/worker/src/modules/analysis/daily-analysis.service.ts`
- Test: `packages/core/src/telegram/format-daily-analysis-plan-message.spec.ts`
- Test: `apps/worker/test/daily-analysis.service.spec.ts`

**Step 1: Write the failing formatter tests**

Add tests that require the formatter to render the new published-plan fields:
- `status`
- `timeframeContext`
- `marketState`
- `primarySetup`
- `secondarySetup`
- validator/hard-check notes when the final output is `WAIT` or `NO_TRADE`

Example expectation:

```ts
expect(message).toContain('Status: WAIT');
expect(message).toContain('Bias frame: D1');
expect(message).toContain('Setup frame: H4');
expect(message).toContain('Primary setup');
expect(message).toContain('Final action');
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @app/core test -- --runInBand format-daily-analysis-plan-message.spec.ts
pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts
```

Expected: FAIL because the formatter still expects the old lightweight plan.

**Step 3: Implement the formatter update**

Refactor the formatter to accept the richer final plan shape:

```ts
formatDailyAnalysisPlanMessage({
  symbol,
  date,
  marketData,
  plan: publishedPlan
});
```

Render:
- fast summary
- timeframe context
- market state
- primary setup
- secondary setup if valid
- no-trade explanation when status is `WAIT` or `NO_TRADE`

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @app/core test -- --runInBand format-daily-analysis-plan-message.spec.ts
pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/telegram apps/worker/src/modules/analysis/daily-analysis.service.ts apps/worker/test/daily-analysis.service.spec.ts
git commit -m "feat: format validated daily analysis reports"
```

### Task 7: Update Docs, Config, And End-To-End Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/llm-trading-prompts.md` only if implementation notes must be cross-linked

**Step 1: Write a final verification checklist**

Document the final runtime expectations:
- worker fetches 200 D1/H4 candles
- pipeline calls Analyst then Validator
- backend hard checks can downgrade to `WAIT`
- DB stores `status`, `aiOutputJson`, and `pipelineDebugJson`

**Step 2: Run the full verification commands**

Run:

```bash
pnpm --filter @app/core test -- --runInBand format-daily-analysis-plan-message.spec.ts daily-analysis-market-data.schema.spec.ts daily-analysis-analyst-draft.schema.spec.ts daily-analysis-validator-result.schema.spec.ts daily-analysis-plan.schema.spec.ts daily-analysis-hard-checks.spec.ts
pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts daily-analysis-market-data.builder.spec.ts publish-daily-analysis-plan.spec.ts daily-analysis.service.spec.ts scheduler.service.spec.ts main.spec.ts market-summary.service.spec.ts
pnpm --filter @app/db test -- --runInBand client.spec.ts daily-analysis.repository.spec.ts
pnpm --filter api test -- --runInBand daily-analysis.e2e-spec.ts
pnpm --filter web test -- --runInBand daily-plan/page.spec.tsx client.spec.ts
pnpm --filter @app/core build
pnpm --filter worker typecheck
```

Expected: PASS.

**Step 3: Update docs/config**

Add/refresh:
- required env vars
- explanation of the two-step pipeline
- note that `WAIT`/`NO_TRADE` are valid outcomes
- note that H1 is intentionally disabled in this version

**Step 4: Re-run the critical smoke checks**

Run:

```bash
pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts claude-daily-analysis.provider.spec.ts
pnpm --filter api test -- --runInBand daily-analysis.e2e-spec.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add .env.example README.md docs
git commit -m "docs: describe validated daily analysis pipeline"
```

