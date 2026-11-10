import { z } from 'zod';

import { BudgetExceededError, mapLimit, type RadarLlm } from '../llm';
import { fillTemplate, POST_NEEDS_PROMPT, POST_NEEDS_SYSTEM, REVIEW_PAIN_PROMPT, REVIEW_PAIN_SYSTEM } from '../prompts/pain-points.prompt';
import { PAIN_CATEGORIES, type PainCategory } from '../types';

/**
 * Pain-point analyzer: 1–2★ reviews per app → repeated complaints (cheap model), and Reddit / HN posts →
 * unmet needs. Several apps share one Claude call (`apps_per_llm_batch`) — each headless call costs
 * ~10–30 s of process start-up, so 40 single-app calls would blow the 30-minute run budget.
 * With dryRun, a keyword heuristic produces the same shape without calling Claude.
 */

export type ReviewInput = { rating: number; title: string | null; body: string };
export type AppReviews = { appId: string; title: string; store: string; reviews: ReviewInput[] };
export type PostInput = { id: string; source: string; title: string; body: string | null; extra?: { subreddit?: string; demandMatch?: string[] } | null };

export type PainPointDraft = {
  source: 'review' | 'post';
  appId: string | null;
  postIds: string[] | null;
  summary: string;
  category: PainCategory;
  frequency: number;
  severity: number;
  quotes: string[];
};

const category = z.enum(PAIN_CATEGORIES as [PainCategory, ...PainCategory[]]);
const quotes = z.array(z.string()).max(5).default([]);

export const reviewPainSchema = z.object({
  apps: z.array(
    z.object({
      ref: z.string(),
      pain_points: z.array(
        z.object({
          summary: z.string().min(3),
          category,
          frequency: z.number().int().min(1),
          severity: z.number().int().min(1).max(5),
          quotes,
        }),
      ),
    }),
  ),
});

export const postNeedsSchema = z.object({
  needs: z.array(
    z.object({
      summary: z.string().min(3),
      category,
      post_refs: z.array(z.string()).min(1),
      frequency: z.number().int().min(1),
      severity: z.number().int().min(1).max(5),
      quotes,
    }),
  ),
});

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Render one batch of apps for the prompt; refs are A1…An within the batch. */
export function renderReviewBatch(batch: AppReviews[], maxReviews: number): string {
  return batch
    .map((a, i) => {
      const lines = a.reviews
        .slice(0, maxReviews)
        .map((r) => `- ★${r.rating} ${r.title ? `${oneLine(clip(r.title, 80))} — ` : ''}${oneLine(clip(r.body, 300))}`);
      return `## ref: A${i + 1} · ${a.title} (${a.store}, ${lines.length} reviews)\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

export function normalizeReviewPain(out: z.infer<typeof reviewPainSchema>, batch: AppReviews[], minFrequency: number, maxReviews: number): PainPointDraft[] {
  const drafts: PainPointDraft[] = [];
  for (const a of out.apps) {
    const idx = Number(a.ref.replace(/^A/i, '')) - 1;
    const app = batch[idx];
    if (!app) continue;
    const reviewCount = Math.min(app.reviews.length, maxReviews);
    for (const p of a.pain_points) {
      const frequency = Math.min(p.frequency, reviewCount);
      if (frequency < minFrequency) continue;
      drafts.push({
        source: 'review',
        appId: app.appId,
        postIds: null,
        summary: p.summary.trim(),
        category: p.category,
        frequency,
        severity: p.severity,
        quotes: p.quotes.slice(0, 3).map((q) => clip(q.trim(), 160)),
      });
    }
  }
  return drafts;
}

export function renderPosts(posts: PostInput[]): string {
  return posts
    .map((p, i) => {
      const where = p.source === 'reddit' ? `r/${p.extra?.subreddit ?? '?'}` : 'HN';
      const body = p.body ? ` — ${oneLine(clip(p.body, 400))}` : '';
      return `- S${i + 1} [${where}] ${oneLine(clip(p.title, 200))}${body}`;
    })
    .join('\n');
}

export function normalizePostNeeds(out: z.infer<typeof postNeedsSchema>, posts: PostInput[]): PainPointDraft[] {
  const drafts: PainPointDraft[] = [];
  for (const n of out.needs) {
    const ids = [
      ...new Set(
        n.post_refs
          .map((r) => posts[Number(r.replace(/^S/i, '')) - 1]?.id)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    if (!ids.length) continue;
    drafts.push({
      source: 'post',
      appId: null,
      postIds: ids,
      summary: n.summary.trim(),
      category: n.category,
      frequency: Math.max(1, Math.min(n.frequency, ids.length)),
      severity: n.severity,
      quotes: n.quotes.slice(0, 2).map((q) => clip(q.trim(), 160)),
    });
  }
  return drafts;
}

// ── dry-run heuristic ─────────────────────────────────────────────────────────────────────────────

const HEURISTICS: Array<[PainCategory, RegExp, string]> = [
  ['ads_too_many', /\bads?\b|advert|quảng cáo/i, 'Quá nhiều quảng cáo'],
  ['paywall', /subscri|paywall|premium|trial|refund|charged|price/i, 'Paywall / thuê bao gây khó chịu'],
  ['bugs_crash', /crash|bug|freez|not working|doesn'?t work|error|lỗi/i, 'Lỗi / crash thường xuyên'],
  ['performance', /slow|lag|battery|loading/i, 'Chậm, tốn pin'],
  ['privacy', /privacy|permission|tracking|my data/i, 'Lo ngại quyền riêng tư'],
  ['missing_feature', /\bwish\b|missing|no option|please add|need(s)? a/i, 'Thiếu tính năng người dùng cần'],
  ['ux', /confus|hard to|interface|design|ui\b/i, 'Giao diện khó dùng'],
];

/** Keyword-count stand-in for the LLM (dry-run): same output shape, no network. */
export function heuristicPainPoints(apps: AppReviews[], minFrequency: number): PainPointDraft[] {
  const out: PainPointDraft[] = [];
  for (const a of apps) {
    for (const [cat, re, label] of HEURISTICS) {
      const hits = a.reviews.filter((r) => re.test(`${r.title ?? ''} ${r.body}`));
      if (hits.length < minFrequency) continue;
      out.push({
        source: 'review',
        appId: a.appId,
        postIds: null,
        summary: `[dry-run] ${a.title}: ${label}`,
        category: cat,
        frequency: hits.length,
        severity: Math.min(5, 2 + Math.floor(hits.length / 5)),
        quotes: hits.slice(0, 3).map((r) => clip(oneLine(r.body), 120)),
      });
    }
  }
  return out;
}

export function heuristicPostNeeds(posts: PostInput[]): PainPointDraft[] {
  return posts
    .filter((p) => (p.extra?.demandMatch?.length ?? 0) > 0)
    .slice(0, 10)
    .map((p) => ({
      source: 'post' as const,
      appId: null,
      postIds: [p.id],
      summary: `[dry-run] Nhu cầu: ${clip(p.title, 120)}`,
      category: 'missing_feature' as const,
      frequency: 1,
      severity: 3,
      quotes: [clip(p.title, 120)],
    }));
}

// ── orchestration ─────────────────────────────────────────────────────────────────────────────────

export type PainPointOptions = {
  minFrequency: number;
  appsPerBatch: number;
  maxReviewsInPrompt: number;
  model: string;
  concurrency: number;
};

export async function analyzeReviewPainPoints(
  llm: RadarLlm | null,
  apps: AppReviews[],
  o: PainPointOptions,
  onError: (msg: string) => void,
): Promise<PainPointDraft[]> {
  const withReviews = apps.filter((a) => a.reviews.length >= o.minFrequency);
  if (!llm) return heuristicPainPoints(withReviews, o.minFrequency);

  const batches = chunk(withReviews, o.appsPerBatch);
  const results = await mapLimit(batches, o.concurrency, async (batch, i) => {
    try {
      const out = await llm.structured(
        'pain_points',
        o.model,
        fillTemplate(REVIEW_PAIN_SYSTEM, { minFrequency: o.minFrequency }),
        fillTemplate(REVIEW_PAIN_PROMPT, { apps: renderReviewBatch(batch, o.maxReviewsInPrompt) }),
        reviewPainSchema,
      );
      return normalizeReviewPain(out, batch, o.minFrequency, o.maxReviewsInPrompt);
    } catch (err) {
      onError(`pain_points batch ${i + 1}/${batches.length}: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof BudgetExceededError) throw err;
      return [];
    }
  });
  return results.flat();
}

export async function analyzePostNeeds(llm: RadarLlm | null, posts: PostInput[], model: string): Promise<PainPointDraft[]> {
  if (!posts.length) return [];
  if (!llm) return heuristicPostNeeds(posts);
  const out = await llm.structured('post_needs', model, POST_NEEDS_SYSTEM, fillTemplate(POST_NEEDS_PROMPT, { posts: renderPosts(posts) }), postNeedsSchema);
  return normalizePostNeeds(out, posts);
}

/** Order for the idea prompt / report: frequency × severity. */
export const painWeight = (p: Pick<PainPointDraft, 'frequency' | 'severity'>) => p.frequency * p.severity;
