# LLM Gateway And Structured Daily Analysis Design

**Goal:** Replace the worker-only Claude summary integration with a backend-owned multi-provider LLM gateway that can later be reused by API and web-facing features, while upgrading daily analysis from plain summary text to full AI-generated analysis and trading-plan data stored in the database.

**User Intent**

The system should not only summarize derived technical signals. It should ask an LLM to analyze the supplied market structure and return a structured daily trading plan. That output must be stored fully in the database so the API and web app can reuse the same data later.

The user also wants provider flexibility over time:

- provider adapter architecture
- support for Claude first
- ability to add OpenAI and Gemini later
- backend-owned access for future web app features

**Current State**

Today the repository has two separate LLM paths:

- worker signal generation uses an OpenAI-compatible client
- daily analysis has just been abstracted behind a `DailyAnalysisLlmProvider`, but it is still specific to the daily-analysis use case

Daily analysis persistence is also text-first:

- `DailyAnalysis` stores technical levels and one `summary`
- API returns that row directly
- web daily-plan UI consumes the same flat shape

This is not enough for full AI analysis and trading-plan features because the system would lose structured output after formatting.

**Recommended Approach**

Build a reusable backend LLM gateway and use it first for structured daily analysis.

The architecture should be split into layers:

1. **Provider adapter layer**
   - generic provider interface
   - concrete adapters: Claude first, OpenAI and Gemini later

2. **Gateway layer**
   - use-case oriented methods
   - first method: `generateDailyAnalysisPlan(input)`

3. **Business services**
   - worker `DailyAnalysisService`
   - future API/chat services
   - future web-backed actions via API

4. **Presentation layer**
   - Telegram formatting from structured AI output
   - API responses returning structured output
   - web UI rendering structured sections

**Why This Approach**

This gives the right separation of responsibilities:

- provider adapters know HTTP payloads, auth headers, and provider-specific response shapes
- gateway methods know the contract for each product use case
- business services stay focused on fetching data, orchestration, persistence, and deduplication

That makes future provider switching cheap and future web features safe because the browser never needs direct provider credentials.

**Provider Architecture**

Introduce a generic adapter contract, for example:

- `LlmProviderAdapter`
- `providerName`
- provider capabilities or method(s)

For the first slice, the gateway only needs one standardized use case:

- `generateDailyAnalysisPlan(input): Promise<DailyAnalysisPlan>`

That method can be implemented by:

- `ClaudeLlmProviderAdapter`
- later `OpenAiLlmProviderAdapter`
- later `GeminiLlmProviderAdapter`

Provider selection should be controlled from backend config, not from business services.

**Daily Analysis Contract**

The worker still computes market structure locally and sends normalized technical input into the gateway:

- `symbol`
- `date`
- `d1.trend`, `d1.s1`, `d1.s2`, `d1.r1`, `d1.r2`
- `h4.trend`, `h4.s1`, `h4.s2`, `h4.r1`, `h4.r2`

The LLM returns structured JSON:

- `analysis`
  - general market read for the day
- `bias`
  - `bullish | bearish | neutral`
- `confidence`
  - integer or bounded numeric confidence
- `tradePlan`
  - `entryZone`
  - `stopLoss`
  - `takeProfit`
  - `invalidation`
- `scenarios`
  - `bullishScenario`
  - `bearishScenario`
- `riskNote`
- `timeHorizon`

This should be schema-validated before persistence.

**Database Design**

Keep the technical columns already present in `DailyAnalysis` because they remain useful for filtering and deterministic inspection.

Add storage for the AI output:

- `llmProvider` string
- `llmModel` string
- `aiOutputJson` text/json column holding the full validated structured output
- keep `summary` text for backwards compatibility and easy Telegram rendering

The `summary` should become a derived formatter output from the structured AI payload, not the primary source of truth.

This allows:

- preserving the full AI response
- changing Telegram formatting later without losing information
- exposing richer API responses to the web app

**API Design**

Extend the API `DailyAnalysisRecord` shape to include the structured AI payload and provider metadata.

The API can return:

- existing technical columns
- `summary`
- `llmProvider`
- `llmModel`
- `aiOutput`

That keeps the current consumers working while enabling the web app to adopt richer sections incrementally.

**Worker Flow**

The daily worker flow becomes:

1. fetch `1d` and `4h` candles
2. derive local technical levels and trends
3. call backend LLM gateway for structured daily analysis
4. validate structured output
5. format `summary` from structured output
6. save technical columns + AI metadata + raw structured payload + summary
7. send Telegram message formatted from structured output if the daily record is new

Deduplication by `symbol + date` remains unchanged.

**Formatting Strategy**

Do not send raw model text straight to Telegram.

Instead:

- LLM returns validated structured output
- formatter converts structured output into a compact Telegram message
- same structured payload can later feed the web UI directly

This avoids coupling presentation to provider wording.

**Configuration**

Introduce backend config for the gateway:

- `LLM_PROVIDER`
  - default initially `claude`
- `CLAUDE_API_KEY`
- `CLAUDE_MODEL`
  - `sonnet | opus`
  - default `sonnet`

Later providers can add:

- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `GEMINI_API_KEY`, `GEMINI_MODEL`

The selection key should be generic so future use cases reuse the same backend routing layer.

**Validation And Safety**

- All daily-analysis AI output must be schema-validated before saving.
- Unknown provider names should fail at configuration time.
- Missing provider credentials should fail clearly.
- Empty or malformed provider responses should fail without writing partial DB rows.
- The scheduler should preserve its current per-symbol fault isolation.

**Migration Strategy**

Recommended rollout:

1. add new DB columns for structured output and provider metadata
2. add gateway and Claude provider adapter
3. migrate daily analysis worker flow to gateway
4. keep summary for compatibility
5. extend API response shape
6. later update web UI to render richer structured sections

**Testing Strategy**

1. gateway/provider selection tests
2. Claude adapter tests
3. structured-schema validation tests
4. `DailyAnalysisService` tests for persistence of full AI output
5. API tests proving richer daily-analysis response shape
6. web mapping tests when UI adoption begins

**Out Of Scope For This Slice**

- migrating chat to the new gateway
- migrating signal generation to the new gateway
- adding browser-direct provider access
- building the richer daily-plan UI

Those are intentionally deferred, but the gateway architecture should not block them.
