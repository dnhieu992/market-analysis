# Daily Analysis LLM Provider Design

**Goal:** Integrate daily analysis with Claude while preserving the existing database persistence and Telegram delivery flow, and make the LLM layer easy to switch to other providers later.

**Current State**

The worker already has a complete daily analysis path:

- `DailyAnalysisService` fetches `1d` and `4h` candles, derives trend and levels, builds a deterministic summary string, and saves the result to `DailyAnalysis`.
- `SchedulerService.sendDailySignals()` stores the daily analysis record and sends the summary to Telegram when the record is new.

The missing piece is an LLM integration layer for `summary`. Right now the summary is built directly inside `DailyAnalysisService`, which makes the service tightly coupled to one output strategy and hard to swap to another LLM later.

**Recommended Approach**

Introduce a provider abstraction dedicated to daily analysis summaries:

- Add a `DailyAnalysisLlmProvider` contract with `generateSummary(input)`.
- Make `DailyAnalysisService` depend on this contract instead of building the final message itself.
- Implement `ClaudeDailyAnalysisProvider` as the first provider.
- Add a provider-selection factory that chooses the implementation from environment configuration.

This keeps the business flow stable:

1. Fetch candles
2. Derive `d1` and `h4` trend/levels
3. Ask the selected LLM provider for a summary
4. Save the result to `DailyAnalysis`
5. Let the existing scheduler send the stored summary to Telegram

**Alternatives Considered**

1. Replace `buildSummary()` with direct Claude HTTP calls inside `DailyAnalysisService`
   - Fastest patch
   - Rejected because it hard-codes Claude into business logic and makes future provider switches expensive

2. Extend the existing worker `LlmService`
   - Reuses an existing module
   - Rejected because the current service is specialized for structured signal JSON and OpenAI-compatible responses, which is a poor fit for provider-agnostic daily summaries

3. Create a dedicated daily-analysis LLM abstraction
   - Slightly more setup now
   - Recommended because it isolates provider concerns and supports future expansion to OpenAI, Gemini, or fallback chains

**Architecture**

Create a new module under `apps/worker/src/modules/llm/` for daily analysis summary generation:

- `daily-analysis-llm.provider.ts`
  - Shared interface and input/output types
- `claude-daily-analysis.provider.ts`
  - Calls the Anthropic Messages API with `CLAUDE_API_KEY`
  - Uses `CLAUDE_MODEL` variant selection
- `daily-analysis-llm.constants.ts`
  - Injection token(s)
- `daily-analysis-llm.module.ts`
  - Binds the selected provider from env

`DailyAnalysisService` will still compute the market structure locally so database fields remain stable and queryable even if the summary wording changes by model.

**Configuration**

Add environment variables:

- `DAILY_ANALYSIS_LLM_PROVIDER`
  - Allowed initially: `claude`
  - Default: `claude`
- `CLAUDE_API_KEY`
  - Required when provider is `claude`
- `CLAUDE_MODEL`
  - Allowed: `sonnet`, `opus`
  - Default: `sonnet`

Model aliases should be resolved internally by the Claude provider so the rest of the app only sees the short variant names.

**Prompt/Data Contract**

The provider input should be normalized and provider-agnostic. It should include:

- `symbol`
- `date`
- `d1.trend`, `d1.s1`, `d1.s2`, `d1.r1`, `d1.r2`
- `h4.trend`, `h4.s1`, `h4.s2`, `h4.r1`, `h4.r2`

The provider returns:

- `summary: string`

Prompt constraints:

- Vietnamese output
- Concise and Telegram-friendly
- Use only supplied market data
- Do not invent news or fundamentals
- Mention directional context and key scenarios using the provided levels

**Error Handling**

- If the selected provider is unknown, fail during provider resolution with a clear message.
- If `CLAUDE_API_KEY` is missing when `claude` is selected, fail clearly.
- If Claude returns an empty summary or malformed payload, throw and do not save a partial daily analysis record.
- Existing scheduler error handling remains in place and will log per-symbol failures without crashing the whole job.

**Testing Strategy**

1. Add provider-selection tests
   - Defaults to Claude
   - Defaults Claude model to `sonnet`
   - Switches to `opus` when configured
   - Rejects unsupported provider values

2. Add Claude provider tests
   - Sends the expected Anthropic request shape
   - Maps `sonnet` and `opus` correctly
   - Extracts text content correctly
   - Fails clearly on empty responses

3. Update `DailyAnalysisService` tests
   - Verify it calls the LLM provider with derived daily-analysis context
   - Verify repository persistence still uses the LLM summary
   - Remove assertions that depend on the previous hard-coded formatter

**Notes**

- This design intentionally scopes provider abstraction to daily analysis first. If we later want the 4h signal analysis flow to become provider-agnostic too, we can either reuse the same provider module or generalize it upward after this integration is stable.
- The database schema does not need to change for this feature.
