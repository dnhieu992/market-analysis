# D1 H4 Breakout Daily Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve daily-analysis AI input so it generates clearer breakout-following trend plans using only `D1` context and `H4` planning indicators.

**Architecture:** Keep the current backend LLM gateway and structured AI output contract, but enrich the gateway input with a compact `H4` indicator pack and update the prompt to prioritize breakout-following trend logic under `D1` context.

**Tech Stack:** NestJS, TypeScript, Jest, existing core indicator utilities

---

### Task 1: Add a typed H4 indicator input contract for daily analysis

**Files:**
- Modify: `apps/worker/src/modules/llm/llm-provider.adapter.ts`
- Test: `apps/worker/test/claude-daily-analysis.provider.spec.ts`

**Step 1: Write the failing test**

Add test expectations showing the daily-analysis gateway input includes:
- `d1` structure
- `h4` structure
- `h4Indicators` with EMA, RSI, MACD, ATR, and volume ratio

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts`
Expected: FAIL because the gateway input type/prompt still only uses trend and levels.

**Step 3: Write minimal implementation**

- Extend the gateway adapter types with `h4Indicators`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts`
Expected: PASS

### Task 2: Build H4 indicator input inside `DailyAnalysisService`

**Files:**
- Modify: `apps/worker/src/modules/analysis/daily-analysis.service.ts`
- Modify: `apps/worker/test/daily-analysis.service.spec.ts`

**Step 1: Write the failing test**

Add a test asserting the gateway receives:
- `ema20`, `ema50`, `ema200`
- `rsi14`
- `macd`
- `atr14`
- `volumeRatio`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts`
Expected: FAIL because the service does not yet compute and pass H4 indicators.

**Step 3: Write minimal implementation**

- Reuse `buildIndicatorSnapshot(...)` for `H4`
- Pass a compact `h4Indicators` object into the gateway

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts`
Expected: PASS

### Task 3: Update Claude prompt for breakout-following trend behavior

**Files:**
- Modify: `apps/worker/src/modules/llm/claude-daily-analysis.provider.ts`
- Modify: `apps/worker/test/claude-daily-analysis.provider.spec.ts`

**Step 1: Write the failing test**

Add a prompt-shape assertion that the provider prompt:
- mentions `D1` as context
- mentions `H4` as primary planning frame
- emphasizes breakout-following trend
- discourages counter-trend setups

**Step 2: Run test to verify it fails**

Run: `pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts`
Expected: FAIL because the current prompt is generic.

**Step 3: Write minimal implementation**

- Update the prompt text to reflect the new trading style.
- Include H4 indicator values in the request body.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter worker test -- --runInBand claude-daily-analysis.provider.spec.ts`
Expected: PASS

### Task 4: Verify the refined daily-analysis slice

**Files:**
- Test: `apps/worker/test/daily-analysis.service.spec.ts`
- Test: `apps/worker/test/claude-daily-analysis.provider.spec.ts`
- Test: `apps/worker/test/main.spec.ts`

**Step 1: Run targeted verification**

Run: `pnpm --filter worker test -- --runInBand daily-analysis.service.spec.ts claude-daily-analysis.provider.spec.ts main.spec.ts worker-bootstrap.spec.ts`
Expected: PASS

**Step 2: Run worker typecheck**

Run: `pnpm --filter worker typecheck`
Expected: PASS
