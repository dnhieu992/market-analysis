# Chat API Design

## Goal

Add a simple backend-owned chat capability that lets the web app send a stateless `messages[]` payload to the API, have the API call OpenAI, and return a simple JSON reply. The design should also leave a clean extension point for future database-query tools without requiring a frontend contract rewrite.

## Scope

### In scope

- Add a new `POST /chat` endpoint in `apps/api`
- Accept stateless chat history from the frontend as `messages[]`
- Return a simple JSON payload like:
  - `reply: string`
  - `model: string`
- Keep all OpenAI credentials and provider logic in backend code
- Introduce a provider abstraction and an empty tool/registry seam for future database querying
- Add backend validation, unit tests, and controller-level tests

### Out of scope

- Streaming responses
- Chat history persistence
- Authentication and rate limiting
- Actual database querying by the model
- Function calling or tool execution in v1
- Frontend implementation beyond consuming the endpoint later

## Product Decisions

- The chat API is backend-only. The frontend will call the API, never OpenAI directly.
- The response format is non-streaming JSON for v1.
- The chat flow is stateless. The frontend sends the full `messages[]` array with each request.
- The backend should be structured so future database tools can plug in without changing the request/response contract.

## Architecture

Add a new `chat` module under `apps/api/src/modules/chat`.

### Proposed flow

`ChatController -> ChatService -> ChatProvider -> OpenAI implementation`

### Responsibilities

- `ChatController`
  - exposes `POST /chat`
  - validates DTO input
  - delegates to service
- `ChatService`
  - validates and normalizes message flow rules
  - builds the final provider request
  - returns a stable API response
  - owns the future tool-registry integration point
- `ChatProvider`
  - interface for model providers
  - v1 implementation: OpenAI chat provider
- `ChatToolRegistry`
  - v1: empty or no-op registry
  - v2+: place to register tools such as trade lookup or signal lookup

## API Contract

### Request

```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Summarize the latest BTC signal." }
  ]
}
```

### Response

```json
{
  "reply": "Here is a concise answer.",
  "model": "gpt-4o-mini"
}
```

## Data Model

### Request types

- `ChatMessageDto`
  - `role: "system" | "user" | "assistant"`
  - `content: string`
- `ChatRequestDto`
  - `messages: ChatMessageDto[]`

### Response types

- `ChatResponseDto`
  - `reply: string`
  - `model: string`

## Extensibility For Future DB Querying

Introduce backend-only abstractions now, even if they are inert in v1.

### `ChatTool`

- `name`
- `description`
- `inputSchema`
- `execute(input): Promise<unknown>`

### `ChatToolRegistry`

- exposes a list or lookup of available tools
- v1 can return an empty list
- v2 can register tools like:
  - `query_trades`
  - `get_latest_signals`
  - `get_analysis_run`

This keeps the future database-query layer in backend orchestration, with no change needed to the frontend chat contract.

## Error Handling

- Invalid request payload
  - return `400`
- Missing or invalid OpenAI configuration
  - return `500`
- Upstream provider failure
  - return a stable backend error, without leaking raw provider internals

The initial version should prefer predictable API behavior over exposing provider-specific metadata.

## Testing Strategy

- unit tests for `ChatService`
  - validates message array expectations
  - maps provider output into API response
  - handles provider failure
- provider tests for OpenAI chat wrapper with mocked HTTP client
- controller/e2e tests for `POST /chat`

No live OpenAI calls are needed in automated tests.

## Notes About Existing Code

- The worker already contains an OpenAI-compatible client, but it is specialized for structured market-analysis output.
- This chat endpoint should live in `apps/api` because that is the public surface the web app will call.
- Reusing the worker implementation directly would couple a user chat flow to worker-specific prompting and JSON parsing, so the API should get its own chat-specific provider wrapper.
