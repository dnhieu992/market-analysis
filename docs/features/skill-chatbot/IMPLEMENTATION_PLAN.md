# Skills Chatbot — Implementation Plan

## Package Structure: `@app/skills`

```
packages/skills/
  src/
    types/
      skill.ts                      # SkillDefinition type
    SkillRegistry.ts                 # Central registry — SKILLS array + getById()
    price-action/
      index.ts                      # SkillDefinition object
      system.ts                     # SYSTEM_PROMPT string
      examples.ts                   # EXAMPLE_QUESTIONS array
      validator.ts                  # Skill-specific output validation (optional MVP)
      formatter.ts                  # Output formatting helpers (optional MVP)
    breakout/
      index.ts
      system.ts
      examples.ts
    swing/
      index.ts
      system.ts
      examples.ts
    dca/
      index.ts
      system.ts
      examples.ts
    risk-management/
      index.ts
      system.ts
      examples.ts
    index.ts                        # re-export everything
  package.json                      # name: "@app/skills"
  tsconfig.json
  jest.config.cjs
```

`SkillDefinition` type:
```ts
export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'analysis' | 'strategy' | 'education';
  systemPrompt: string;
  tools: string[];
  exampleQuestions: string[];
  welcomeMessage: string;
};
```

---

## Task Breakdown

### [x] Task 1 — Create `packages/skills/` package
Files to create:
- `packages/skills/package.json`
- `packages/skills/tsconfig.json`
- `packages/skills/jest.config.cjs`
- `packages/skills/src/types/skill.ts`
- `packages/skills/src/SkillRegistry.ts`
- `packages/skills/src/price-action/{index,system,examples}.ts`
- `packages/skills/src/breakout/{index,system,examples}.ts`
- `packages/skills/src/swing/{index,system,examples}.ts`
- `packages/skills/src/dca/{index,system,examples}.ts`
- `packages/skills/src/risk-management/{index,system,examples}.ts`
- `packages/skills/src/index.ts`

Wire into workspace:
- `pnpm-workspace.yaml` already covers `packages/*` — no change needed
- Add `"@app/skills": ["packages/skills/src"]` to `tsconfig.base.json` paths (API/worker inherit automatically)

---

### [x] Task 2 — Add `analyze_market_structure` tool to `@app/core`

Clone preprocessing logic from worker (`swing-signal-preprocessor.ts`) into `@app/core`.
Worker code stays untouched — `@app/core` has its own independent copy.

New files in `packages/core/src/analysis/`:
- `market-structure.ts` — cloned & adapted: `detectSwings()`, `detectTrend()`, `analyzeVolume()`, `calculateAtr()`, `detectKeyLevels()`, `calculateFibLevels()`, `analyzeMarketStructure()`

New tool in API (`apps/api/src/modules/chat/tools/`):
- `market-structure.tool.ts` — `analyze_market_structure` ChatTool
  - Input: `{ symbol: string }`
  - Internally: fetch klines (1w/1d/4h) from Binance → run `analyzeMarketStructure()` from `@app/core`
  - Output: pre-processed JSON (trend, swings, S/R, ATR, volume, fibonacci)

Register in `TradingChatToolRegistry`.

---

### [x] Task 3 — DB: add `skillId` to `Conversation`
Schema change in `packages/db/prisma/schema.prisma`:
```prisma
model Conversation {
  ...
  skillId   String?   @db.VarChar(50)
  ...
}
```

Migration file: `packages/db/prisma/migrations/<timestamp>_add_skill_id_to_conversations/migration.sql`
```sql
ALTER TABLE `conversations` ADD COLUMN `skillId` VARCHAR(50) NULL;
```

Run `pnpm prisma:generate` after schema change.

Update `ConversationRepository` (`packages/db/src/repositories/conversation.repository.ts`):
- `create(userId, title, skillId?)` — pass skillId on create
- `listByUser(userId, skillId?)` — filter by skillId if provided
- `listByUser` select: add `skillId` to select fields

---

### [x] Task 4 — API: `skills` module
```
apps/api/src/modules/skills/
  skills.controller.ts    # GET /skills, GET /skills/:id
  skills.service.ts       # getAll(), getById() — wraps SkillRegistry
  skills.module.ts
```

Endpoints:
- `GET /skills` — returns `SkillPublicDto[]` (excludes systemPrompt)
- `GET /skills/:id` — returns single `SkillPublicDto` or 404

`SkillPublicDto` (what API returns):
```ts
{ id, name, description, icon, category, tools, exampleQuestions, welcomeMessage }
```

---

### [x] Task 5 — API: skill-aware `ConversationService`
Changes to `apps/api/src/modules/chat/conversation.service.ts`:
- `createConversation(userId, title?, skillId?)` — pass skillId to repo
- `listConversations(userId, skillId?)` — filter when skillId given
- `sendMessage(...)`:
  - Load `conv.skillId` → `SkillRegistry.getById()` → get skill system prompt
  - Filter tools: `allTools.filter(t => skill.tools.includes(t.name))` if skill present, else all tools
  - `buildSystemPrompt(userId, skill?)` — use skill system prompt if present, else current general prompt

Changes to `apps/api/src/modules/chat/dto/create-conversation.dto.ts`:
- Add optional `skillId?: string` field

Changes to `apps/api/src/modules/chat/chat.controller.ts`:
- Pass `body.skillId` to `createConversation()`
- Add `@Query('skillId')` to `listConversations()` endpoint

---

### [x] Task 6 — Frontend: `/skills` page + sidebar nav
Route: `apps/web/src/app/skills/page.tsx`
Implementation: `apps/web/src/pages/skills/skills-page.tsx`

- Add "Skills" entry to sidebar navigation
- Server Component: fetch `GET /skills`, pass to client grid
- `SkillCard` — icon, name, category badge, description, "Use Skill" button
- Click card / "Use Skill" → `POST /chat/conversations` with `skillId` → navigate to `/skills/[skillId]/chat/[conversationId]`

(No detail page — click goes directly to chat)

---

### [x] Task 7 — Frontend: `/skills/[skillId]/chat/[conversationId]` chat page
Route: `apps/web/src/app/skills/[skillId]/chat/[conversationId]/page.tsx`
Implementation: `apps/web/src/pages/skills/skill-chat-page.tsx`

Features:
- Left sidebar: skill info, conversation list for this skill, "New conversation"
- Main chat: welcome message, suggested quick actions, message thread, input
- Reuse existing chat API calls (`POST /chat/conversations/:id/messages`)
- "Thinking" indicator while waiting for response

---

### [x] Task 8 — Frontend: remove old chatbot widget
- Remove chatbot widget import/usage from trades page
- Remove widget component files
- Clean up unused imports/dependencies

---

## File Map Summary

| Layer | Files changed/created |
|-------|----------------------|
| Package `@app/skills` | `packages/skills/**` (new) |
| Package `@app/core` | `packages/core/src/analysis/market-structure.ts` (new) |
| DB | `schema.prisma`, migration SQL, `conversation.repository.ts` |
| API | `modules/skills/**` (new), `chat/conversation.service.ts`, `chat/tools/market-structure.tool.ts` (new), `chat/tools/trading-chat-tool-registry.ts`, `chat/dto/create-conversation.dto.ts`, `chat/chat.controller.ts` |
| Web | `app/skills/**` (new routes), `pages/skills/**` (new), sidebar nav |

---

## Implementation Order

1. `packages/skills/` — types + SkillRegistry + 5 skill definitions
2. `packages/core/` — clone market structure analysis functions
3. DB: schema + migration + repository update
4. API: `skills` module (GET /skills, GET /skills/:id)
5. API: `market-structure.tool.ts` + register in tool registry
6. API: `ConversationService` skill-aware updates (system prompt, tool filtering)
7. Web: sidebar nav + `/skills` list page
8. Web: `/skills/[skillId]/chat/[conversationId]` chat page
9. Web: remove old chatbot widget

---

## Constraints

- Worker code (`apps/worker/`) is NOT modified — all Telegram flows (daily analysis, swing signal, swing PA) remain untouched
- `@app/core` market structure functions are an independent copy, not shared with worker's `swing-signal-preprocessor.ts`
- Existing conversations (skillId = null) continue to work as general chat
