# Web FSD Refactor Design

**Date:** 2026-04-02

**Status:** Approved

## Goal

Refactor `apps/web` to follow a pragmatic Feature-Sliced Design structure without rewriting the dashboard from scratch and without regressing the existing Overview, Trading History, and Analysis Feed flows.

## Chosen Direction

Use a **Pragmatic FSD** layout:

- `app`
- `pages`
- `widgets`
- `features`
- `entities`
- `shared`

This refactor should improve code organization and future feature scalability while staying close to the current implementation and minimizing product risk.

## Why Pragmatic FSD

- the current web app is still young, so a lighter refactor gives structure without excessive churn
- strict FSD now would add ceremony faster than it adds value
- the dashboard already has useful boundaries by route and domain, which map well into pragmatic FSD
- we want a codebase that is easier to grow, not a refactor that stalls progress

## Target Structure

### `app`

Keep only App Router entrypoints and top-level composition:

- route files
- root layout
- route-level providers if later needed

### `pages`

Contain page-specific composition logic:

- `overview-page`
- `trades-page`
- `analysis-page`

Each page should compose widgets and page-specific data loading, but avoid low-level UI implementation details.

### `widgets`

Contain large, page-visible blocks:

- app shell
- dashboard overview sections
- trades history block
- analysis feed block

Widgets should coordinate features and entities, not own domain mutations directly.

### `features`

Contain user actions and focused interactive flows:

- create trade
- close trade
- select analysis

Features can own form state, submit logic, and small UI tied to a single intent.

### `entities`

Contain domain representations and reusable domain UI:

- order
- signal
- analysis-run

Typical contents:

- typed view models
- display helpers
- reusable domain cards, rows, badges, or formatters when tied to one domain concept

### `shared`

Contain generic cross-cutting utilities:

- API client
- config
- formatting helpers not tied to one domain
- generic UI primitives if needed later

## Migration Strategy

Refactor **incrementally by screen**, not all at once:

1. create the FSD folder structure and shared aliases
2. migrate overview route and dashboard widgets
3. migrate trades flow into widgets/features/entities
4. migrate analysis feed into widgets/features/entities
5. clean imports and remove old `components` / `lib` leftovers

This keeps the app working after each step and makes verification much easier.

## Rules For This Refactor

- keep routes stable: `/`, `/trades`, `/analysis`
- do not change product scope or visual direction during the refactor
- avoid introducing unnecessary abstraction layers
- prefer colocating code by business meaning over technical type
- use public exports only where they improve imports clearly; do not overbuild barrels

## Success Criteria

- `apps/web` follows the pragmatic FSD structure
- route behavior remains unchanged
- create/close trade flows still work
- analysis feed still uses structured `signals` and `analysis-runs`
- test, lint, typecheck, and build remain green

## Out of Scope

- auth
- additional dashboard features
- charting
- websocket/realtime updates
- a strict FSD enforcement system across every file
