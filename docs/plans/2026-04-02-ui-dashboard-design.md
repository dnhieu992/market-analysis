# UI Dashboard Design

**Date:** 2026-04-02

**Status:** Approved

## Goal

Add a web UI to the monorepo so users can:

- view an overview dashboard
- view structured market analyses from `signals` and `analysis-runs`
- view trading history
- create manual trades
- close trades from the web

Authentication is intentionally out of scope for v1.

## Chosen Approach

Build a new Next.js app inside the monorepo as a dedicated web client. The UI will call the existing API directly and will not introduce a new backend-for-frontend layer in v1.

## Why This Approach

- keeps frontend concerns separate from the NestJS API
- gives a strong path for future expansion such as auth, richer dashboards, filters, and charts
- supports server-first rendering and route-based organization for a dashboard UI
- fits the product direction better than embedding templates directly in the API app

## Product Scope

### Primary Entry

The default landing page is an `Overview Dashboard`.

### Main Screens

#### Overview Dashboard

Purpose:

- provide a fast snapshot of account activity and recent analysis

Sections:

- KPI summary cards
  - open orders
  - closed orders
  - recent signals count
  - average confidence of recent signals
- recent analysis panel
- recent order activity panel
- quick actions
  - add manual trade
  - open trading history
  - open analysis feed

#### Trading History

Purpose:

- view all historical orders and operate manual trading workflows

Capabilities:

- list orders
- create manual trades
- close open trades

Layout:

- desktop: split layout with form and data table
- mobile: stacked form followed by order list

#### Analysis Feed

Purpose:

- display structured analysis data created by the worker

Primary data sources:

- `signals`
- `analysis-runs`

Capabilities:

- browse recent analyses
- inspect symbol, timeframe, trend, bias, confidence, summary, support, resistance, and candle timestamps
- open a detail view that ties a signal to its related analysis run

## Data Sources

The web app will use existing API endpoints:

- `GET /signals`
- `GET /signals/latest`
- `GET /analysis-runs`
- `GET /analysis-runs/:id`
- `GET /orders`
- `POST /orders`
- `PATCH /orders/:id/close`
- `GET /health`

No Telegram log UI is included in v1 because the approved scope is based on structured analysis data from signals and analysis runs.

## UX Principles

- prioritize scanability for numbers, direction, and status
- keep client-side state narrow and local
- use server-first page rendering where practical
- avoid heavy charting and realtime features in v1
- keep the UI mobile-friendly without optimizing for mobile-only usage

## Visual Direction

- clean, bright dashboard with a trading/editorial feel
- strong emphasis on symbols, confidence, trend, and PnL
- clear directional color semantics
  - bullish: green
  - bearish: red
  - neutral: amber/earth
- avoid generic admin-template styling

## Technical Direction

- create a new Next.js app in `apps/web`
- use shared API fetch helpers inside the web app
- keep forms simple and typed
- prefer server components and selective client components
- keep implementation aligned with performance-first React and Next.js practices

## Out of Scope

- authentication and authorization
- WebSocket/realtime updates
- advanced charting
- Telegram log viewer
- portfolio analytics
- queue-based worker dispatch from the UI

## Risks and Constraints

- current API filtering is basic, so UI should keep v1 queries simple
- manual trigger API is still a lightweight stub, so the dashboard should not depend on it as a core workflow
- some UI refinement may later justify dedicated API endpoints for dashboard aggregation

## Success Criteria

- a new web app runs inside the monorepo
- overview dashboard renders useful order and analysis summaries
- users can create and close trades in the browser
- users can inspect structured analysis information from worker output
- no authentication is required for local/internal usage
