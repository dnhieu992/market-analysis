# Daily Analysis LLM Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make worker daily analysis summaries use a switchable LLM provider, with Claude as the first implementation and Sonnet as the default Claude model.

**Architecture:** Add a provider abstraction for daily-analysis summaries, bind the active implementation from environment configuration, and refactor `DailyAnalysisService` to depend on that abstraction instead of building the summary inline. Keep candle fetching, derived trend/levels, persistence, and Telegram delivery unchanged so only the summary-generation layer becomes provider-aware.

**Tech Stack:** NestJS, TypeScript, Jest, Axios, pnpm, Anthropic Messages API

---

### Task 1: Lock down provider-selection behavior with failing tests

**Files:**
- Create: `apps/worker/test/daily-analysis-llm.module.spec.ts`
- Modify: `apps/worker/src/modules/llm/daily-analysis-llm.module.ts`
- Modify: `apps/worker/src/modules/llm/daily-analysis-llm.constants.ts`

**Step 1: Write the failing test**

```ts
it('defaults to Claude provider and Sonnet model', async () => {
  delete process.env.DAILY_ANALYSIS_LLM_PROVIDER;
  delete process.env.CLAUDE_MODEL;

  const provider = createDailyAnalysisLlmProvider();

  expect(provider.providerName).toBe('claude');
  expect(provider.modelVariant).toBe('sonnet');
});

it('switches Claude model to opus when configured', async () => {
  process.env.DAILY_ANALYSIS_LLM_PROVIDER = 'claude';
  process.env.CLAUDE_MODEL = 'opus';

  const provider = createDailyAnalysisLlmProvider();

  expect(provider.modelVariant).toBe('opus');
});

it('throws for unsupported providers', async () => {
  process.env.DAILY_ANALYSIS_LLM_PROVIDER = 'unknown';

  expect(() => createDailyAnalysisLlmProvider()).toThrow('Unsupported daily analysis LLM provider');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand daily-analysis-llm.module.spec.ts`
Expected: FAIL because the module/factory files do not exist yet.

**Step 3: Write minimal implementation**

- Add an injection token for the daily-analysis provider.
- Add a provider factory that reads `DAILY_ANALYSIS_LLM_PROVIDER` and `CLAUDE_MODEL`.
- Return Claude as the default selected provider and `sonnet` as the default model variant.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand daily-analysis-llm.module.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/test/daily-analysis-llm.module.spec.ts apps/worker/src/modules/llm/daily-analysis-llm.module.ts apps/worker/src/modules/llm/daily-analysis-llm.constants.ts
git commit -m "test: add daily analysis llm provider selection"
```

### Task 2: Add Claude provider tests before implementation

**Files:**
- Create: `apps/worker/test/claude-daily-analysis.provider.spec.ts`
- Modify: `apps/worker/src/modules/llm/claude-daily-analysis.provider.ts`

**Step 1: Write the failing test**

```ts
it('calls Anthropic messages API and returns the summary text', async () => {
  const post = jest.fn().mockResolvedValue({
    data: {
      content: [{ type: 'text', text: 'Tong quan BTC hom nay...' }]
    }
  });

  const provider = new ClaudeDailyAnalysisProvider(
    { post } as never,
    'sonnet',
    'test-key'
  );

  await expect(
    provider.generateSummary({
      symbol: 'BTCUSDT',
      date: new Date('2026-04-07T00:00:00.000Z'),
      d1: { trend: 'bullish', s1: 1, s2: 2, r1: 3, r2: 4 },
      h4: { trend: 'neutral', s1: 5, s2: 6, r1: 7, r2: 8 }
    })
  ).resolves.toBe('Tong quan BTC hom nay...');

  expect(post).toHaveBeenCalledWith('/messages', expect.objectContaining({
    model: expect.any(String)
  }));
});

it('maps opus variant to the Opus model id', () => {
  const provider = new ClaudeDailyAnalysisProvider({ post: jest.fn() } as never, 'opus', 'test-key');
  expect(provider.getResolvedModel()).toContain('opus');
});

it('throws when Claude returns no text content', async () => {
  const provider = new ClaudeDailyAnalysisProvider(
    { post: jest.fn().mockResolvedValue({ data: { content: [] } }) } as never,
    'sonnet',
    'test-key'
  );

  await expect(provider.generateSummary(input)).rejects.toThrow('Claude daily analysis response was empty');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts`
Expected: FAIL because the provider does not exist yet.

**Step 3: Write minimal implementation**

- Create `ClaudeDailyAnalysisProvider`.
- Build an Anthropic request with system/user instructions and normalized input.
- Resolve `sonnet` and `opus` to concrete Claude model ids.
- Extract the first text response and trim it.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/test/claude-daily-analysis.provider.spec.ts apps/worker/src/modules/llm/claude-daily-analysis.provider.ts
git commit -m "feat: add claude daily analysis provider"
```

### Task 3: Refactor `DailyAnalysisService` behind the new provider contract

**Files:**
- Modify: `apps/worker/src/modules/analysis/daily-analysis.service.ts`
- Modify: `apps/worker/test/daily-analysis.service.spec.ts`
- Modify: `apps/worker/src/modules/analysis/analysis.module.ts`

**Step 1: Write the failing test**

```ts
it('passes derived market structure to the daily analysis llm provider', async () => {
  const generateSummary = jest.fn().mockResolvedValue('LLM summary');
  const service = new DailyAnalysisService(
    { getCandles } as never,
    repo,
    { generateSummary } as never
  );

  await service.analyze('BTCUSDT');

  expect(generateSummary).toHaveBeenCalledWith(expect.objectContaining({
    symbol: 'BTCUSDT',
    d1: expect.objectContaining({ trend: expect.any(String) }),
    h4: expect.objectContaining({ trend: expect.any(String) })
  }));
});

it('persists the llm-generated summary', async () => {
  const generateSummary = jest.fn().mockResolvedValue('LLM summary');
  const outcome = await service.analyzeAndSave('BTCUSDT');

  expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
    summary: 'LLM summary'
  }));
  expect(outcome.result.summary).toBe('LLM summary');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts`
Expected: FAIL because `DailyAnalysisService` still uses the hard-coded formatter.

**Step 3: Write minimal implementation**

- Remove direct summary construction from `DailyAnalysisService`.
- Inject the new provider.
- Build a provider input object from derived `d1` and `h4` values.
- Use the provider result as the saved `summary`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/src/modules/analysis/daily-analysis.service.ts apps/worker/test/daily-analysis.service.spec.ts apps/worker/src/modules/analysis/analysis.module.ts
git commit -m "refactor: use llm provider for daily analysis summaries"
```

### Task 4: Wire the Claude provider into the worker module

**Files:**
- Modify: `apps/worker/src/modules/llm/llm.module.ts`
- Modify: `apps/worker/src/modules/analysis/analysis.module.ts`
- Modify: `apps/worker/src/modules/worker.module.ts`

**Step 1: Write the failing test**

```ts
it('resolves DailyAnalysisService with a configured daily analysis provider', async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AnalysisModule]
  }).compile();

  expect(moduleRef.get(DailyAnalysisService)).toBeInstanceOf(DailyAnalysisService);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand worker-bootstrap.spec.ts daily-analysis-llm.module.spec.ts`
Expected: FAIL if the module graph does not provide the new dependency yet.

**Step 3: Write minimal implementation**

- Export the daily-analysis provider from the LLM module.
- Import that module where `DailyAnalysisService` is instantiated.
- Keep existing non-daily-analysis LLM wiring unchanged.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand worker-bootstrap.spec.ts daily-analysis-llm.module.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/worker/src/modules/llm/llm.module.ts apps/worker/src/modules/analysis/analysis.module.ts apps/worker/src/worker.module.ts
git commit -m "feat: wire daily analysis llm provider into worker"
```

### Task 5: Document environment changes and verify the full worker test slice

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Test: `apps/worker/test/daily-analysis.service.spec.ts`
- Test: `apps/worker/test/daily-analysis-llm.module.spec.ts`
- Test: `apps/worker/test/claude-daily-analysis.provider.spec.ts`
- Test: `apps/worker/test/worker-bootstrap.spec.ts`

**Step 1: Write the failing documentation expectation**

Check that docs do not yet describe:
- `DAILY_ANALYSIS_LLM_PROVIDER`
- `CLAUDE_API_KEY`
- `CLAUDE_MODEL`

**Step 2: Update docs**

- Add the new env vars to `.env.example`
- Document defaults and allowed values in `README.md`

**Step 3: Run targeted verification**

Run: `pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts daily-analysis-llm.module.spec.ts claude-daily-analysis.provider.spec.ts worker-bootstrap.spec.ts`
Expected: PASS

**Step 4: Run broader verification**

Run: `pnpm --filter worker typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add .env.example README.md apps/worker/test
git commit -m "docs: add daily analysis llm configuration"
```
