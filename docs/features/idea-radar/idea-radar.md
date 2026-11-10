# App Idea Radar (/idea-radar)

Shipped 2026-11-10. Weekly pipeline that turns public store / community data into scored app ideas
for a solo developer (2–4 week MVP, ads or subscription, English markets + optional VN). Content is
in Vietnamese. Built from the "App Idea Radar — Đặc tả hệ thống" spec, adapted to this repo: NestJS
module + Prisma/MySQL + a web page instead of the spec's Python CLI / SQLite.

## Flow (`apps/api/src/modules/idea-radar/`)
`IdeaRadarService.pipeline` — cron `0 0 7 * * 1` Asia/Ho_Chi_Minh (Monday 07:00 VN), or the page's
"Chạy ngay" / "Dry-run" (`POST /idea-radar/run {dryRun}`, runs in the background; the page polls).

1. **collect** — the 4 collectors run in parallel (different hosts); each is independent, its errors
   go to `run.errors` and the run continues.
   - `app-store.ts` — Apple charts `rss.marketingtools.apple.com/api/v2/{cc}/apps/{top-free|top-paid}/{n}`
     (the spec's `rss.applemarketingtools.com` 301s here), iTunes lookup (≤ 100 ids/call) + search.
   - `google-play.ts` — unofficial `google-play-scraper` v10 (ESM, lazy `import()`): category top
     charts (flag `use_top_charts`), keyword search, seed apps; detail pages (installs, ads, IAP,
     rating count) for ≤ `max_detail_apps` apps — Play ratings are global, so one detail page fills
     every country's rows.
   - `hackernews.ts` — Algolia `search_by_date` Show HN + keyword stories, last 7 days, ≥ `min_points`.
   - `reddit.ts` — **public Atom feeds** (`/r/{sub}/top/.rss?t=week`, `/new/.rss`). Reddit's JSON is
     403 from the VPS IP and new API apps need approval (user chose RSS). No score / comment count,
     and Reddit 429s after a few quick calls → `request_delay_seconds` 8 + backoff; a failing
     subreddit is just an error line. Author names are stripped.
   - `http.ts` — UA `app-idea-radar/0.1`, retry ×3 exponential backoff (429 / 5xx / network,
     honours Retry-After), **day cache** in `$TMPDIR/idea-radar-cache/<VN date>/` (pruned after 7 days)
     so a same-day re-run doesn't hit the sources again.
2. **trends** (`analyzers/trends.ts`, no LLM) — this run vs the previous run with snapshots:
   `rank_jump` ≥ 20 places, `new_entry` (never charted before; skipped on the first run),
   `fast_growth` rating count ≥ +30 % (prev ≥ 50), `rating_drop` ≥ 0.3. One signal per app & type.
3. **reviews** — `analyzers/targets.ts` picks ≤ `max_apps_for_review_analysis` apps (signal apps,
   then keyword/seed apps, then chart rank; split across both stores) and collects their newest
   1–2★ reviews per country (Apple RSS ≤ 10 pages; Play newest ×3 then filtered). No reviewer names.
4. **pain_points** (`analyzers/pain-points.ts`, cheap model) — `apps_per_llm_batch` apps per Claude
   call (each headless call has ~10–30 s start-up), `concurrency` 2; keeps frequency ≥ 3.
   Reddit/HN posts (demand keywords first) → "unmet needs" in one call.
5. **ideas** (`ideas/generator.ts`, smart model) — top 30 signals, 40 pain points (freq × severity),
   30 posts, the profile and the last 8 runs' idea titles, as refs T1/P1/S1. Structured output
   (zod → JSON schema, validated, retried once with the errors). Refs map back to DB ids with links;
   an idea without evidence is dropped, ≥ 2 refs preferred. `repeat_of` (or same slug) → status `repeat`.
   `ideas/scorer.ts` adjusts demand (refs, review frequency) and competition (tracked competitor
   rating / size / rating_drop), total = Σ weight × score; top `ideas_per_report` kept.
6. **report** (`report/render.ts`) — Markdown in `idea_radar_runs.reportMd` (page tab "Báo cáo",
   "Tải .md"): summary, top ideas, trends table, top 10 pain points, repeats, collection errors.
7. **notify** (`report/telegram.ts`) — HTML summary (top 3) + the .md as a document. Only when
   `IDEA_RADAR_TELEGRAM_CHAT_ID` is set (bot: `IDEA_RADAR_TELEGRAM_BOT_TOKEN` else
   `TELEGRAM_BOT_TOKEN`); **empty for now — user will add it later**. Optional `IDEA_RADAR_PAGE_URL`
   adds a "Xem đầy đủ" link.

## Claude
Headless Claude Code via `ClaudeChatProvider.askStructured()` (claude.ai login on the box, no API
key; added `outputFormat` + `onResult` to the provider). Models in config: `claude-haiku-5-5` /
`claude-sonnet-5-5`. Every call → `idea_radar_llm_usages` (SDK cost **estimate**, billed to the plan);
`monthly_budget_usd` (20) stops the LLM steps when the VN calendar month is over. `GET /idea-radar/cost`.
Dry-run: no Claude, no Telegram — keyword heuristics produce `[dry-run]` pain points / ideas.

## Data (`packages/db`, migration `20261110200000_idea_radar`)
`idea_radar_runs` (one per VN day: `runDate` unique — a same-day re-run resets that row, snapshots
upsert, reviews/posts dedupe on unique keys → idempotent), `_apps`, `_app_snapshots`, `_reviews`,
`_posts`, `_pain_points`, `_trend_signals`, `_ideas` (status new|repeat|dismissed|shortlisted),
`_llm_usages`, `_settings` (id `default`: editable config JSON, merged over `config.ts` defaults).
A restart marks leftover RUNNING rows FAILED.

## API / page
`GET /idea-radar/overview` · `GET /idea-radar/runs/:id` · `POST /idea-radar/run` ·
`GET /idea-radar/ideas?status=` · `PATCH /idea-radar/ideas/:id {status}` · `GET /idea-radar/cost` ·
`GET|PUT /idea-radar/config`. Page tabs: Kỳ này (summary, idea cards with score bars, details,
☆ Shortlist / Bỏ qua, earlier runs) · Shortlist · Tất cả ý tưởng · Báo cáo · Cấu hình (JSON editor).

## Not built (spec MVP items left out)
Product Hunt (default off; needs a token), email notifier, Reddit comments (RSS has none; each would
be another rate-limited request). Tests: `apps/api/test/idea-radar/` (fixtures in `test/fixtures/idea-radar`).
