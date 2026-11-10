import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ClaudeChatProvider } from '../chat/providers/claude-chat.provider';
import { analyzePostNeeds, analyzeReviewPainPoints, painWeight, type PainPointDraft, type PostInput } from './analyzers/pain-points';
import { pickReviewTargets } from './analyzers/targets';
import { analyzeTrends, signalStrength } from './analyzers/trends';
import { AppStoreCollector } from './collectors/app-store';
import { errMsg, type CollectContext, type Collector } from './collectors/base';
import { GooglePlayCollector } from './collectors/google-play';
import { HackerNewsCollector } from './collectors/hackernews';
import { RedditCollector } from './collectors/reddit';
import { DEFAULT_CONFIG, resolveConfig, type IdeaRadarConfig } from './config';
import { HttpClient, vnDate } from './http';
import { IdeaRadarStore } from './idea-radar.store';
import { generateIdeas, type GeneratorInput, type PainCtx, type PostCtx, type SignalCtx } from './ideas/generator';
import { rankByScore, scoreIdea, type ScoreEvidence } from './ideas/scorer';
import { BudgetExceededError, RadarLlm } from './llm';
import { renderReport, renderTelegramSummary, type ReportData } from './report/render';
import { sendReport, telegramTarget } from './report/telegram';
import type { CollectResult, RunError } from './types';

/**
 * App Idea Radar pipeline: collect → trends → reviews → pain points (cheap model) → ideas (smart model)
 * → score → Markdown report → Telegram. Runs every Monday 07:00 Vietnam time, or from the page
 * ("Chạy ngay" / dry-run). One run per VN day — a same-day re-run reuses and overwrites it.
 * A failing source or LLM step is recorded in run.errors; the report is still produced from what's left.
 */

const CACHE_DIR = join(tmpdir(), 'idea-radar-cache');
const MAX_ERRORS_PER_SOURCE = 6;

export type StartResult = { started: boolean; runId: string | null; message: string };

@Injectable()
export class IdeaRadarService implements OnModuleInit {
  private readonly logger = new Logger(IdeaRadarService.name);
  private running: Promise<void> | null = null;
  private runningId: string | null = null;
  private readonly collectors: Collector[] = [new AppStoreCollector(), new GooglePlayCollector(), new HackerNewsCollector(), new RedditCollector()];

  constructor(
    private readonly store: IdeaRadarStore,
    private readonly claude: ClaudeChatProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.store.markInterrupted().catch((err) => this.logger.warn(`markInterrupted: ${errMsg(err)}`));
    await this.pruneCache();
  }

  @Cron('0 0 7 * * 1', { timeZone: 'Asia/Ho_Chi_Minh' })
  async cron(): Promise<void> {
    const r = this.start('CRON', false);
    this.logger.log(`Idea Radar weekly run: ${r.message}`);
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  async getConfig(): Promise<IdeaRadarConfig> {
    try {
      return resolveConfig(await this.store.getStoredConfig());
    } catch (err) {
      this.logger.warn(`Stored config invalid, using defaults: ${errMsg(err)}`);
      return DEFAULT_CONFIG;
    }
  }

  /** Validate (throws ZodError) and store. */
  async setConfig(input: unknown): Promise<IdeaRadarConfig> {
    const cfg = resolveConfig(input);
    await this.store.saveConfig(cfg);
    return cfg;
  }

  /** Kick off a run in the background (the page polls the run row). */
  start(trigger: 'CRON' | 'MANUAL', dryRun: boolean): StartResult {
    if (this.running) return { started: false, runId: this.runningId, message: 'Đang có một lần chạy khác' };
    this.running = this.pipeline(trigger, dryRun)
      .catch((err) => this.logger.error(`Idea Radar run crashed: ${errMsg(err)}`))
      .finally(() => {
        this.running = null;
        this.runningId = null;
      });
    return { started: true, runId: null, message: dryRun ? 'Đã bắt đầu dry-run' : 'Đã bắt đầu chạy' };
  }

  /** For tests / scripts: run and wait. */
  async runNow(trigger: 'CRON' | 'MANUAL', dryRun: boolean): Promise<void> {
    const r = this.start(trigger, dryRun);
    if (!r.started) throw new Error(r.message);
    await this.running;
  }

  private async pipeline(trigger: 'CRON' | 'MANUAL', dryRun: boolean): Promise<void> {
    const cfg = await this.getConfig();
    const runDate = vnDate();
    const run = await this.store.startRun(runDate, trigger, dryRun);
    this.runningId = run.id;
    const errors: RunError[] = [];
    const t0 = Date.now();
    const log = (msg: string) => this.logger.log(`[${runDate}] ${msg}`);
    const step = (name: string) => {
      log(`step ${name} (+${Math.round((Date.now() - t0) / 1000)}s)`);
      return this.store.updateRun(run.id, { step: name, errors });
    };
    const addErrors = (source: string, messages: string[]) => {
      for (const m of messages.slice(0, MAX_ERRORS_PER_SOURCE)) errors.push({ source, message: m });
      if (messages.length > MAX_ERRORS_PER_SOURCE) errors.push({ source, message: `… và ${messages.length - MAX_ERRORS_PER_SOURCE} lỗi khác` });
    };

    try {
      const ctx: CollectContext = { runId: run.id, config: cfg, http: new HttpClient(), sink: this.store, log };
      const enabled = this.collectors.filter((c) => c.enabled(cfg));

      // 1. Collect — different hosts, so the sources run side by side.
      await step('collect');
      const collected = await Promise.all(
        enabled.map((c) =>
          c.collect(ctx).catch((err): CollectResult => ({ source: c.name, inserted: 0, updated: 0, errors: [`lỗi toàn bộ nguồn: ${errMsg(err)}`] })),
        ),
      );
      for (const r of collected) {
        log(`${r.source}: +${r.inserted} / ~${r.updated}, ${r.errors.length} errors`);
        addErrors(r.source, r.errors);
      }

      // 2. Trends (no LLM).
      await step('trends');
      const prevRunId = await this.store.previousRunId(runDate);
      const drafts = analyzeTrends(
        await this.store.snapRows(run.id),
        prevRunId ? await this.store.snapRows(prevRunId) : [],
        await this.store.everChartedKeys(runDate),
        cfg.analysis,
      );
      const signals = await this.store.saveSignals(run.id, drafts);

      // 3. Reviews for the chosen apps.
      await step('reviews');
      const targets = pickReviewTargets(await this.store.runApps(run.id), signals, cfg.analysis.max_apps_for_review_analysis);
      const reviewResults = await Promise.all(
        enabled
          .filter((c) => c.collectReviews)
          .map((c) =>
            (c.collectReviews as NonNullable<Collector['collectReviews']>)(ctx, targets).catch(
              (err): CollectResult => ({ source: `${c.name}_reviews`, inserted: 0, updated: 0, errors: [errMsg(err)] }),
            ),
          ),
      );
      for (const r of reviewResults) addErrors(r.source, r.errors);

      // 4. Pain points.
      await step('pain_points');
      let llm: RadarLlm | null = dryRun ? null : new RadarLlm(this.claude, this.store.usageSink(run.id), cfg.llm.monthly_budget_usd);
      let llmBlocked = false;
      if (llm) {
        try {
          await llm.assertBudget();
        } catch (err) {
          errors.push({ source: 'llm', message: errMsg(err) });
          llmBlocked = true;
          llm = null;
        }
      }

      const reviewMap = await this.store.reviewsForApps(
        targets.map((t) => t.id),
        cfg.analysis.max_reviews_per_app_in_prompt,
      );
      const appReviews = targets.map((t) => ({ appId: t.id, title: t.title, store: t.store, reviews: reviewMap.get(t.id) ?? [] }));
      const reviewsAnalyzed = appReviews.reduce((s, a) => s + a.reviews.length, 0);

      const since = new Date(Date.now() - 7 * 86_400_000);
      const posts = rankPosts(await this.store.recentPosts(since));
      let pains: PainPointDraft[] = [];
      if (!llmBlocked) {
        const painOpts = {
          minFrequency: cfg.analysis.min_pain_point_frequency,
          appsPerBatch: cfg.analysis.apps_per_llm_batch,
          maxReviewsInPrompt: cfg.analysis.max_reviews_per_app_in_prompt,
          model: cfg.llm.cheap_model,
          concurrency: cfg.llm.concurrency,
        };
        const [reviewPains, postNeeds] = await Promise.all([
          analyzeReviewPainPoints(llm, appReviews, painOpts, (m) => errors.push({ source: 'pain_points', message: m })).catch((err) => {
            errors.push({ source: 'pain_points', message: errMsg(err) });
            return [] as PainPointDraft[];
          }),
          analyzePostNeeds(llm, posts.slice(0, 60).map(toPostInput), cfg.llm.cheap_model).catch((err) => {
            errors.push({ source: 'post_needs', message: errMsg(err) });
            return [] as PainPointDraft[];
          }),
        ]);
        pains = [...reviewPains, ...postNeeds];
      }
      const savedPains = await this.store.savePainPoints(run.id, pains);

      // 5. Ideas + scores.
      await step('ideas');
      const postById = new Map(posts.map((p) => [p.id, p]));
      const signalCtx: SignalCtx[] = [...signals]
        .sort((a, b) => signalStrength(b as never) - signalStrength(a as never))
        .slice(0, 30)
        .map((s) => ({ id: s.id, appTitle: s.app.title, store: s.app.store, signalType: s.signalType, value: s.value, details: (s.details as Record<string, unknown>) ?? null, url: s.app.url }));
      const painCtx: PainCtx[] = [...savedPains]
        .sort((a, b) => painWeight(b) - painWeight(a))
        .slice(0, 40)
        .map((p) => {
          const postIds = (p.postIds as string[] | null) ?? [];
          return {
            id: p.id,
            appTitle: p.app?.title ?? null,
            summary: p.summary,
            category: p.category,
            frequency: p.frequency,
            severity: p.severity,
            source: p.source,
            url: p.app?.url ?? postById.get(postIds[0] ?? '')?.url ?? null,
          };
        });
      const postCtx: PostCtx[] = posts.slice(0, 30).map((p) => ({
        id: p.id,
        source: p.source,
        title: p.title,
        body: p.body,
        url: p.url,
        score: p.score,
        subreddit: (p.extra as { subreddit?: string } | null)?.subreddit ?? null,
      }));
      const input: GeneratorInput = {
        signals: signalCtx,
        painPoints: painCtx,
        posts: postCtx,
        previous: await this.store.previousIdeas(runDate),
        profile: cfg.profile,
        // Ask for a few extra; the scorer keeps the best `ideas_per_report`.
        count: Math.min(12, cfg.scoring.ideas_per_report + 3),
      };

      let ideas: Awaited<ReturnType<typeof generateIdeas>> = [];
      if (!llmBlocked && (signalCtx.length || painCtx.length || postCtx.length)) {
        try {
          ideas = await generateIdeas(llm, input, cfg.llm.smart_model);
        } catch (err) {
          errors.push({ source: 'ideas', message: errMsg(err) });
          if (err instanceof BudgetExceededError) llmBlocked = true;
        }
      }

      // Competitors we track → scoring evidence.
      const known = await this.store.appsByTitle(ideas.flatMap((i) => i.competitors.map((c) => c.name)));
      const droppingApps = new Set(signals.filter((s) => s.signalType === 'rating_drop').map((s) => s.appId));
      const painById = new Map(savedPains.map((p) => [p.id, p]));
      const scored = ideas.map((idea) => {
        const evidence: ScoreEvidence = {
          painPoints: idea.evidence.filter((e) => e.type === 'pain_point').map((e) => painById.get(e.id) ?? { frequency: 1, severity: 1 }),
          signalCount: idea.evidence.filter((e) => e.type === 'trend_signal').length,
          postCount: idea.evidence.filter((e) => e.type === 'post').length,
          competitors: idea.competitors.flatMap((c) => {
            const name = c.name.trim().toLowerCase();
            const match = known.find((k) => k.title.toLowerCase().startsWith(name));
            const snap = match?.snapshots[0];
            return match ? [{ rating: snap?.rating ?? null, ratingCount: snap?.ratingCount ?? null, ratingDrop: droppingApps.has(match.id) }] : [];
          }),
        };
        return { ...idea, scores: scoreIdea(idea.rawScores, evidence, cfg.scoring.weights), status: idea.repeatOf ? ('repeat' as const) : ('new' as const) };
      });
      const top = rankByScore(scored, cfg.scoring.ideas_per_report);
      await this.store.saveIdeas(run.id, top);

      // 6. Report.
      await step('report');
      const counts = await this.store.counts(run.id);
      const llmCostUsd = await this.store.runCostUsd(run.id);
      const stats = {
        ...counts,
        reviewsAnalyzed,
        postsAnalyzed: posts.length,
        signals: signals.length,
        painPoints: savedPains.length,
        llmCostUsd,
        reviewTargets: targets.length,
        durationSec: Math.round((Date.now() - t0) / 1000),
      };
      const report: ReportData = {
        runDate,
        dryRun,
        stats,
        ideas: top,
        trends: signalCtx.slice(0, 20).map((s) => ({ appTitle: s.appTitle, store: s.store, url: s.url, signalType: s.signalType, value: s.value, details: s.details })),
        painPoints: [...savedPains]
          .sort((a, b) => painWeight(b) - painWeight(a))
          .slice(0, 10)
          .map((p) => ({ appTitle: p.app?.title ?? null, summary: p.summary, category: p.category, frequency: p.frequency, severity: p.severity, quotes: (p.quotes as string[] | null) ?? [] })),
        errors,
        pageUrl: process.env.IDEA_RADAR_PAGE_URL || null,
      };
      const reportMd = renderReport(report);
      await this.store.updateRun(run.id, { reportMd, stats, errors });

      // 7. Notify.
      if (!dryRun && cfg.notify.telegram.enabled) {
        const target = telegramTarget();
        if (target) {
          await step('notify');
          try {
            await sendReport(target, renderTelegramSummary(report), `idea-radar-${runDate}.md`, reportMd);
          } catch (err) {
            errors.push({ source: 'telegram', message: errMsg(err) });
          }
        } else {
          log('Telegram not configured (IDEA_RADAR_TELEGRAM_CHAT_ID empty) — skipped');
        }
      }

      const status = errors.length ? 'PARTIAL' : 'SUCCESS';
      await this.store.updateRun(run.id, { status, step: null, errors, finishedAt: new Date(), stats: { ...stats, durationSec: Math.round((Date.now() - t0) / 1000) } });
      log(`done: ${status}, ${top.length} ideas, ${errors.length} errors, ${stats.durationSec}s`);
    } catch (err) {
      errors.push({ source: 'pipeline', message: errMsg(err) });
      this.logger.error(`[${runDate}] failed: ${err instanceof Error ? err.stack : String(err)}`);
      await this.store.updateRun(run.id, { status: 'FAILED', step: null, errors, finishedAt: new Date() }).catch(() => undefined);
    }
  }

  /** Drop day-cache folders older than a week. */
  private async pruneCache(): Promise<void> {
    try {
      const cutoff = vnDate(new Date(Date.now() - 7 * 86_400_000));
      for (const dir of await readdir(CACHE_DIR)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dir) && dir < cutoff) await rm(join(CACHE_DIR, dir), { recursive: true, force: true });
      }
    } catch {
      /* no cache yet */
    }
  }
}

type PostRow = { id: string; source: string; title: string; body: string | null; url: string; score: number | null; extra: unknown; postedAt: Date };

/** Posts for the LLM: demand-keyword matches first, then HN by points, then the rest by recency. */
export function rankPosts<T extends PostRow>(posts: T[]): T[] {
  const demand = (p: PostRow) => ((p.extra as { demandMatch?: string[] } | null)?.demandMatch?.length ?? 0) > 0;
  return [...posts].sort((a, b) => {
    const d = Number(demand(b)) - Number(demand(a));
    if (d) return d;
    const s = (b.score ?? 0) - (a.score ?? 0);
    if (s) return s;
    return b.postedAt.getTime() - a.postedAt.getTime();
  });
}

function toPostInput(p: PostRow): PostInput {
  return { id: p.id, source: p.source, title: p.title, body: p.body, extra: (p.extra as PostInput['extra']) ?? null };
}
