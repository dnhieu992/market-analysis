# Swing PA Limit Order Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Claude review prompt in `SwingPaReviewService` so that when all limit setups are skipped (or absent), Claude must propose at least one replacement limit order.

**Architecture:** Single prompt string change in `swing-pa-review.service.ts`. No schema, type, or formatter changes. A unit test verifies the axios POST body contains the required prompt instructions.

**Tech Stack:** NestJS, axios, Jest

---

### Task 1: Write failing test for prompt content

**Files:**
- Create: `apps/worker/test/swing-pa-review.service.spec.ts`

- [ ] **Step 1: Create the test file**

```ts
import axios from 'axios';
import { SwingPaReviewService } from '../src/modules/analysis/swing-pa-review.service';
import type { SwingPaAnalysis } from '../src/modules/analysis/swing-pa-analyzer';
import type { Candle } from '@app/core';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockAnalysis: SwingPaAnalysis = {
  symbol: 'BTCUSDT',
  currentPrice: 84000,
  trend: 'uptrend',
  swingHighs: [80000, 85000],
  swingLows: [75000, 78000],
  consecutiveHhCount: 3,
  consecutiveHlCount: 3,
  srZones: [
    { low: 77500, high: 78500, midpoint: 78000, touches: 3, role: 'support' }
  ],
  choch: { detected: false, from: 'uptrend', to: 'uptrend', brokenLevel: null },
  setup: {
    type: null, entryType: 'market', direction: null, confidence: 'low',
    limitPrice: null, entryZone: null, stopLoss: null, tp1: null, tp2: null,
    notes: ['No active setup']
  },
  pendingLimitSetups: [],
  avgVolume20: 1000
};

const mockCandles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
  open: 80000 + i * 100,
  high: 80500 + i * 100,
  low: 79500 + i * 100,
  close: 80200 + i * 100,
  volume: 1000,
  openTime: new Date(`2026-01-${String(i + 1).padStart(2, '0')}`)
}));

describe('SwingPaReviewService', () => {
  let service: SwingPaReviewService;
  let capturedPostBody: Record<string, unknown>;

  beforeEach(() => {
    service = new SwingPaReviewService();
    mockedAxios.create.mockReturnValue({
      post: jest.fn().mockImplementation((_url, body) => {
        capturedPostBody = body as Record<string, unknown>;
        return Promise.resolve({
          data: {
            content: [
              {
                type: 'tool_use',
                name: 'record_swing_pa_review',
                input: {
                  verdict: 'no-trade',
                  trendComment: 'Test',
                  limitSetupReviews: [],
                  warnings: [],
                  summary: 'Test'
                }
              }
            ]
          }
        });
      })
    } as never);
  });

  it('system prompt instructs Claude to review each pendingLimitSetup', async () => {
    await service.review(mockAnalysis, mockCandles);
    const systemPrompt = capturedPostBody['system'] as string;
    expect(systemPrompt).toContain('pendingLimitSetups');
    expect(systemPrompt).toContain('limitSetupReviews');
  });

  it('system prompt instructs Claude to add replacement limit order when all setups skip', async () => {
    await service.review(mockAnalysis, mockCandles);
    const systemPrompt = capturedPostBody['system'] as string;
    expect(systemPrompt).toContain('adjusted');
    expect(systemPrompt).toContain('srZones');
    expect(systemPrompt).toContain('adjustedEntry');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter worker test -- --testPathPattern=swing-pa-review
```

Expected: FAIL — assertions fail because the current prompt does not mention `pendingLimitSetups`, `srZones`, or `adjustedEntry`.

---

### Task 2: Update the system prompt

**Files:**
- Modify: `apps/worker/src/modules/analysis/swing-pa-review.service.ts` (line ~111)

- [ ] **Step 1: Replace the `system` string in the `client.post` call**

Find the current system string (lines ~111–115):
```ts
system:
  'You are a senior pure price action swing trader reviewing an automated analysis. ' +
  "Review the setups strictly — prioritize R:R ≥ 2, zone quality (≥2 touches), " +
  "and trend alignment. Adjust or skip setups that don't meet the bar. " +
  'Always respond in Vietnamese.',
```

Replace with:
```ts
system:
  'You are a senior pure price action swing trader reviewing an automated analysis. ' +
  "Review the setups strictly — prioritize R:R ≥ 2, zone quality (≥2 touches), " +
  "and trend alignment. Adjust or skip setups that don't meet the bar. " +
  'For each item in pendingLimitSetups, add a corresponding entry to limitSetupReviews — ' +
  'apply the same R:R ≥ 2 and zone quality criteria. ' +
  'If all limit setups are judged skip, or pendingLimitSetups is empty, you MUST add ' +
  'at least one replacement limit order to limitSetupReviews with verdict "adjusted". ' +
  'Choose the strongest support or resistance zone from srZones in the analysis data. ' +
  'Provide adjustedEntry [low, high], adjustedSl, adjustedTp1, and a reason in Vietnamese. ' +
  'Always respond in Vietnamese.',
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
pnpm --filter worker test -- --testPathPattern=swing-pa-review
```

Expected: PASS — both assertions satisfied.

- [ ] **Step 3: Run full worker test suite to confirm no regressions**

```bash
pnpm --filter worker test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/modules/analysis/swing-pa-review.service.ts \
        apps/worker/test/swing-pa-review.service.spec.ts
git commit -m "feat(worker): instruct Claude to suggest limit order when all setups skip"
```
