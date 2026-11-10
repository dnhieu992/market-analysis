import { Injectable } from '@nestjs/common';
import { prisma } from '@app/db';
import type { Prisma } from '@prisma/client';

import type { SnapRow, TrendSignalDraft } from './analyzers/trends';
import type { PainPointDraft } from './analyzers/pain-points';
import type { CollectorSink } from './collectors/base';
import type { IdeaDraft } from './ideas/generator';
import type { FinalScores } from './ideas/scorer';
import type { LlmUsageRecord, LlmUsageSink } from './llm';
import type { AppObservation, IdeaStatus, PostRecord, ReviewRecord, RunError, Store } from './types';

/** All Idea Radar DB access (Prisma). Also the collectors' sink. */

const json = (v: unknown) => v as Prisma.InputJsonValue;
const appKey = (store: string, storeAppId: string) => `${store}|${storeAppId}`;
const snapKey = (s: { appId: string; country: string; chart: string; category: string }) => `${s.appId}|${s.country}|${s.chart}|${s.category}`;

@Injectable()
export class IdeaRadarStore implements CollectorSink {
  private readonly db = prisma;

  // ── config ─────────────────────────────────────────────────────────────────────────────────────

  async getStoredConfig(): Promise<unknown> {
    const row = await this.db.ideaRadarSetting.findUnique({ where: { id: 'default' } });
    return row?.config ?? null;
  }

  async saveConfig(config: unknown): Promise<void> {
    await this.db.ideaRadarSetting.upsert({ where: { id: 'default' }, create: { id: 'default', config: json(config) }, update: { config: json(config) } });
  }

  // ── runs ───────────────────────────────────────────────────────────────────────────────────────

  /** Today's run row, created or reset for a fresh pass (same-day re-runs reuse it → no duplicates). */
  async startRun(runDate: string, trigger: string, dryRun: boolean) {
    const existing = await this.db.ideaRadarRun.findUnique({ where: { runDate } });
    if (existing) {
      await this.db.$transaction([
        this.db.ideaRadarPainPoint.deleteMany({ where: { runId: existing.id } }),
        this.db.ideaRadarTrendSignal.deleteMany({ where: { runId: existing.id } }),
        this.db.ideaRadarIdea.deleteMany({ where: { runId: existing.id } }),
      ]);
      return this.db.ideaRadarRun.update({
        where: { id: existing.id },
        data: { trigger, dryRun, status: 'RUNNING', step: 'collect', startedAt: new Date(), finishedAt: null, errors: json([]), stats: json({}), reportMd: null },
      });
    }
    return this.db.ideaRadarRun.create({ data: { runDate, trigger, dryRun, status: 'RUNNING', step: 'collect', errors: json([]) } });
  }

  updateRun(id: string, data: { status?: string; step?: string | null; errors?: RunError[]; stats?: unknown; reportMd?: string; finishedAt?: Date }) {
    return this.db.ideaRadarRun.update({
      where: { id },
      data: {
        ...data,
        errors: data.errors ? json(data.errors) : undefined,
        stats: data.stats ? json(data.stats) : undefined,
      },
    });
  }

  /** A restart mid-run leaves RUNNING rows behind. */
  markInterrupted() {
    return this.db.ideaRadarRun.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED', step: null, finishedAt: new Date() } });
  }

  listRuns(limit = 20) {
    return this.db.ideaRadarRun.findMany({
      orderBy: { runDate: 'desc' },
      take: limit,
      select: { id: true, runDate: true, trigger: true, dryRun: true, status: true, step: true, startedAt: true, finishedAt: true, errors: true, stats: true },
    });
  }

  getRun(id: string) {
    return this.db.ideaRadarRun.findUnique({ where: { id } });
  }

  latestRun() {
    return this.db.ideaRadarRun.findFirst({ orderBy: { runDate: 'desc' } });
  }

  /** Most recent earlier run that collected snapshots (the comparison base for trends). */
  async previousRunId(runDate: string): Promise<string | null> {
    const prev = await this.db.ideaRadarRun.findFirst({
      where: { runDate: { lt: runDate }, snapshots: { some: {} } },
      orderBy: { runDate: 'desc' },
      select: { id: true },
    });
    return prev?.id ?? null;
  }

  // ── sink ───────────────────────────────────────────────────────────────────────────────────────

  private async ensureApps(observations: AppObservation[]): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    const wanted = new Map(observations.map((o) => [appKey(o.app.store, o.app.storeAppId), o.app]));
    const byStore = new Map<string, string[]>();
    for (const a of wanted.values()) byStore.set(a.store, [...(byStore.get(a.store) ?? []), a.storeAppId]);

    const load = async () => {
      for (const [store, storeAppIds] of byStore) {
        for (let i = 0; i < storeAppIds.length; i += 500) {
          const rows = await this.db.ideaRadarApp.findMany({ where: { store, storeAppId: { in: storeAppIds.slice(i, i + 500) } }, select: { id: true, store: true, storeAppId: true } });
          for (const r of rows) ids.set(appKey(r.store, r.storeAppId), r.id);
        }
      }
    };
    await load();
    const missing = [...wanted.entries()].filter(([k]) => !ids.has(k)).map(([, a]) => a);
    if (missing.length) {
      await this.db.ideaRadarApp.createMany({
        data: missing.map((a) => ({
          store: a.store,
          storeAppId: a.storeAppId.slice(0, 200),
          title: a.title.slice(0, 300),
          developer: a.developer?.slice(0, 300) ?? null,
          category: a.category?.slice(0, 100) ?? null,
          url: a.url?.slice(0, 500) ?? null,
        })),
        skipDuplicates: true,
      });
      await load();
    }
    return ids;
  }

  async saveObservations(runId: string, observations: AppObservation[]) {
    const appIds = await this.ensureApps(observations);
    const rows = observations
      .map((o) => {
        const appId = appIds.get(appKey(o.app.store, o.app.storeAppId));
        if (!appId) return null;
        const s = o.snapshot;
        return {
          appId,
          runId,
          country: s.country,
          chart: s.chart,
          category: (s.category ?? '').slice(0, 40),
          rank: s.rank ?? null,
          installs: s.installs ?? null,
          rating: s.rating ?? null,
          ratingCount: s.ratingCount ?? null,
          price: s.price ?? null,
          hasAds: s.hasAds ?? null,
          hasIap: s.hasIap ?? null,
          updatedOn: s.updatedOn && !Number.isNaN(s.updatedOn.getTime()) ? s.updatedOn : null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const existing = await this.db.ideaRadarAppSnapshot.findMany({
      where: { runId, appId: { in: [...new Set(rows.map((r) => r.appId))] } },
      select: { id: true, appId: true, country: true, chart: true, category: true },
    });
    const existingIds = new Map(existing.map((e) => [snapKey(e), e.id]));
    const fresh = rows.filter((r) => !existingIds.has(snapKey(r)));
    const stale = rows.filter((r) => existingIds.has(snapKey(r)));

    if (fresh.length) await this.db.ideaRadarAppSnapshot.createMany({ data: fresh, skipDuplicates: true });
    for (const r of stale) {
      await this.db.ideaRadarAppSnapshot.update({ where: { id: existingIds.get(snapKey(r)) as string }, data: { ...r, capturedAt: new Date() } });
    }
    return { inserted: fresh.length, updated: stale.length };
  }

  async saveReviews(runId: string, store: Store, storeAppId: string, reviews: ReviewRecord[]): Promise<number> {
    const app = await this.db.ideaRadarApp.findUnique({ where: { store_storeAppId: { store, storeAppId } }, select: { id: true } });
    if (!app || !reviews.length) return 0;
    const res = await this.db.ideaRadarReview.createMany({
      data: reviews.map((r) => ({
        appId: app.id,
        storeReviewId: r.storeReviewId.slice(0, 191),
        country: r.country,
        rating: r.rating,
        title: r.title?.slice(0, 500) ?? null,
        body: r.body,
        reviewDate: r.reviewDate && !Number.isNaN(r.reviewDate.getTime()) ? r.reviewDate : null,
        collectedRunId: runId,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  async savePosts(runId: string, posts: PostRecord[]) {
    const existing = await this.db.ideaRadarPost.findMany({ where: { externalId: { in: posts.map((p) => p.externalId) } }, select: { externalId: true } });
    const have = new Set(existing.map((e) => e.externalId));
    const fresh = posts.filter((p) => !have.has(p.externalId));
    if (fresh.length) {
      await this.db.ideaRadarPost.createMany({
        data: fresh.map((p) => ({
          source: p.source,
          externalId: p.externalId.slice(0, 191),
          title: p.title.slice(0, 500),
          body: p.body ?? null,
          url: p.url.slice(0, 1000),
          score: p.score ?? null,
          numComments: p.numComments ?? null,
          postedAt: p.postedAt,
          collectedRunId: runId,
          extra: p.extra ? json(p.extra) : undefined,
        })),
        skipDuplicates: true,
      });
    }
    let updated = 0;
    for (const p of posts.filter((x) => have.has(x.externalId) && x.score !== null && x.score !== undefined)) {
      await this.db.ideaRadarPost.update({ where: { externalId: p.externalId }, data: { score: p.score, numComments: p.numComments ?? null } });
      updated += 1;
    }
    return { inserted: fresh.length, updated };
  }

  // ── analysis inputs ────────────────────────────────────────────────────────────────────────────

  async snapRows(runId: string): Promise<SnapRow[]> {
    return this.db.ideaRadarAppSnapshot.findMany({
      where: { runId },
      select: { appId: true, country: true, chart: true, category: true, rank: true, rating: true, ratingCount: true },
    });
  }

  /** Every (app, country, chart, category) that was in a top chart before this run. */
  async everChartedKeys(runDate: string): Promise<Set<string>> {
    const rows = await this.db.ideaRadarAppSnapshot.findMany({
      where: { chart: { in: ['top_free', 'top_paid'] }, run: { runDate: { lt: runDate } } },
      select: { appId: true, country: true, chart: true, category: true },
      distinct: ['appId', 'country', 'chart', 'category'],
    });
    return new Set(rows.map(snapKey));
  }

  /** Apps seen this run with their best rank and the store info needed to pick review targets. */
  async runApps(runId: string) {
    const rows = await this.db.ideaRadarAppSnapshot.findMany({
      where: { runId },
      select: { chart: true, rank: true, ratingCount: true, app: { select: { id: true, store: true, storeAppId: true, title: true } } },
    });
    const byApp = new Map<string, { id: string; store: Store; storeAppId: string; title: string; bestRank: number; inSearch: boolean; ratingCount: number }>();
    for (const r of rows) {
      const prev = byApp.get(r.app.id) ?? {
        id: r.app.id,
        store: r.app.store as Store,
        storeAppId: r.app.storeAppId,
        title: r.app.title,
        bestRank: Infinity,
        inSearch: false,
        ratingCount: 0,
      };
      if (r.chart === 'search' || r.chart === 'seed') prev.inSearch = true;
      else if (r.rank !== null) prev.bestRank = Math.min(prev.bestRank, r.rank);
      prev.ratingCount = Math.max(prev.ratingCount, r.ratingCount ?? 0);
      byApp.set(r.app.id, prev);
    }
    return [...byApp.values()];
  }

  /** Newest stored 1–2★ reviews per app (from any run). */
  async reviewsForApps(appIds: string[], perApp: number) {
    const out = new Map<string, Array<{ rating: number; title: string | null; body: string }>>();
    for (const appId of appIds) {
      const rows = await this.db.ideaRadarReview.findMany({
        where: { appId },
        orderBy: { reviewDate: 'desc' },
        take: perApp,
        select: { rating: true, title: true, body: true },
      });
      out.set(appId, rows);
    }
    return out;
  }

  apps(ids: string[]) {
    return this.db.ideaRadarApp.findMany({ where: { id: { in: ids } } });
  }

  recentPosts(since: Date) {
    return this.db.ideaRadarPost.findMany({ where: { postedAt: { gte: since } }, orderBy: { postedAt: 'desc' } });
  }

  // ── analysis outputs ───────────────────────────────────────────────────────────────────────────

  async saveSignals(runId: string, signals: TrendSignalDraft[]) {
    await this.db.ideaRadarTrendSignal.deleteMany({ where: { runId } });
    if (signals.length) {
      await this.db.ideaRadarTrendSignal.createMany({
        data: signals.map((s) => ({ runId, appId: s.appId, signalType: s.signalType, value: s.value, details: json(s.details) })),
      });
    }
    return this.db.ideaRadarTrendSignal.findMany({ where: { runId }, include: { app: true } });
  }

  async savePainPoints(runId: string, points: PainPointDraft[]) {
    await this.db.ideaRadarPainPoint.deleteMany({ where: { runId } });
    if (points.length) {
      await this.db.ideaRadarPainPoint.createMany({
        data: points.map((p) => ({
          runId,
          appId: p.appId,
          postIds: p.postIds ? json(p.postIds) : undefined,
          source: p.source,
          summary: p.summary,
          category: p.category,
          frequency: p.frequency,
          severity: p.severity,
          quotes: json(p.quotes),
        })),
      });
    }
    return this.db.ideaRadarPainPoint.findMany({ where: { runId }, include: { app: true } });
  }

  async saveIdeas(runId: string, ideas: Array<IdeaDraft & { scores: FinalScores; status: IdeaStatus }>) {
    await this.db.ideaRadarIdea.deleteMany({ where: { runId } });
    if (ideas.length) {
      await this.db.ideaRadarIdea.createMany({
        data: ideas.map((i) => ({
          runId,
          title: i.title.slice(0, 300),
          slug: i.slug.slice(0, 191),
          oneLiner: i.oneLiner,
          targetUsers: i.targetUsers,
          problem: i.problem,
          solution: i.solution,
          keyFeatures: json(i.keyFeatures),
          monetization: json(i.monetization),
          competitors: json(i.competitors),
          evidence: json(i.evidence),
          scoreDemand: i.scores.demand,
          scoreCompetition: i.scores.competition,
          scoreMonetization: i.scores.monetization,
          scoreEffort: i.scores.effort,
          scoreTotal: i.scores.total,
          repeatOf: i.repeatOf?.slice(0, 300) ?? null,
          status: i.status,
        })),
      });
    }
  }

  /** Titles of ideas from the last `runs` runs before `runDate` (to avoid / flag repeats). */
  async previousIdeas(runDate: string, runs = 8) {
    const prev = await this.db.ideaRadarRun.findMany({
      where: { runDate: { lt: runDate }, dryRun: false },
      orderBy: { runDate: 'desc' },
      take: runs,
      select: { id: true },
    });
    const rows = await this.db.ideaRadarIdea.findMany({ where: { runId: { in: prev.map((p) => p.id) } }, select: { title: true, slug: true }, orderBy: { createdAt: 'desc' } });
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.slug) ? false : (seen.add(r.slug), true)));
  }

  /** Latest snapshot (rating) of apps whose title matches one of the names — for competitor scoring. */
  async appsByTitle(names: string[]) {
    const cleaned = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))].slice(0, 60);
    if (!cleaned.length) return [];
    return this.db.ideaRadarApp.findMany({
      where: { OR: cleaned.map((n) => ({ title: { startsWith: n } })) },
      select: { id: true, title: true, snapshots: { orderBy: { capturedAt: 'desc' }, take: 1, select: { rating: true, ratingCount: true } } },
      take: 200,
    });
  }

  // ── ideas & cost (page) ────────────────────────────────────────────────────────────────────────

  runIdeas(runId: string) {
    return this.db.ideaRadarIdea.findMany({ where: { runId }, orderBy: { scoreTotal: 'desc' } });
  }

  listIdeas(status?: IdeaStatus, limit = 100) {
    return this.db.ideaRadarIdea.findMany({
      where: status ? { status } : {},
      orderBy: [{ createdAt: 'desc' }, { scoreTotal: 'desc' }],
      take: limit,
      include: { run: { select: { runDate: true, dryRun: true } } },
    });
  }

  markIdea(id: string, status: IdeaStatus) {
    return this.db.ideaRadarIdea.update({ where: { id }, data: { status } });
  }

  async runCostUsd(runId: string): Promise<number> {
    const agg = await this.db.ideaRadarLlmUsage.aggregate({ where: { runId }, _sum: { costUsd: true } });
    return agg._sum.costUsd ?? 0;
  }

  async monthCost(now = new Date()) {
    // Calendar month in Vietnam time.
    const vn = new Date(now.getTime() + 7 * 3_600_000);
    const start = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1) - 7 * 3_600_000);
    const rows = await this.db.ideaRadarLlmUsage.groupBy({
      by: ['step', 'model'],
      where: { createdAt: { gte: start } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: { _all: true },
    });
    const totalUsd = rows.reduce((s, r) => s + (r._sum.costUsd ?? 0), 0);
    return {
      since: start.toISOString(),
      totalUsd,
      byStep: rows.map((r) => ({
        step: r.step,
        model: r.model,
        calls: r._count._all,
        costUsd: r._sum.costUsd ?? 0,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
      })),
    };
  }

  usageSink(runId: string): LlmUsageSink {
    return {
      monthCostUsd: async () => (await this.monthCost()).totalUsd,
      recordUsage: async (u: LlmUsageRecord) => {
        await this.db.ideaRadarLlmUsage.create({ data: { runId, ...u } });
      },
    };
  }

  // ── stats ──────────────────────────────────────────────────────────────────────────────────────

  async counts(runId: string) {
    const [snapshots, apps] = await Promise.all([
      this.db.ideaRadarAppSnapshot.count({ where: { runId } }),
      this.db.ideaRadarAppSnapshot.findMany({ where: { runId }, distinct: ['appId'], select: { appId: true } }),
    ]);
    return { snapshots, appsTracked: apps.length };
  }
}
