import { z } from 'zod';

/**
 * Pipeline config. Defaults below = the spec's config.example.yaml; the page edits a JSON copy stored
 * in idea_radar_settings (id "default"), merged over these defaults so new keys appear automatically.
 * Secrets never live here: Telegram comes from env (IDEA_RADAR_TELEGRAM_CHAT_ID, …).
 */

const countries = z.array(z.string().regex(/^[a-z]{2}$/)).min(1);

export const ideaRadarConfigSchema = z.object({
  profile: z.object({
    role: z.string(),
    skills: z.array(z.string()),
    time_per_week_hours: z.number().positive(),
    budget_usd: z.number().nonnegative(),
    target_markets: z.array(z.string()),
    preferred_monetization: z.array(z.string()),
  }),
  sources: z.object({
    google_play: z.object({
      enabled: z.boolean(),
      countries,
      keywords: z.array(z.string()),
      seed_apps: z.array(z.string()),
      /** Top charts via google-play-scraper `list` (feature flag — breaks first when Play changes). */
      use_top_charts: z.boolean(),
      chart_categories: z.array(z.string()),
      chart_limit: z.number().int().min(10).max(200),
      search_limit: z.number().int().min(5).max(50),
      /** Apps whose detail page is fetched (installs, ads, IAP) — the slow part. */
      max_detail_apps: z.number().int().min(0).max(300),
      max_reviews_per_app: z.number().int().min(0).max(1000),
      request_delay_seconds: z.number().min(0).max(30),
    }),
    app_store: z.object({
      enabled: z.boolean(),
      countries,
      charts: z.array(z.enum(['top-free', 'top-paid'])),
      chart_limit: z.number().int().min(10).max(200),
      keywords: z.array(z.string()),
      search_limit: z.number().int().min(5).max(50),
      max_reviews_per_app: z.number().int().min(0).max(500),
      request_delay_seconds: z.number().min(0).max(30),
    }),
    reddit: z.object({
      enabled: z.boolean(),
      subreddits: z.array(z.string()),
      /** Reddit blocks unauthenticated JSON from server IPs, so posts come from the public RSS feeds (no score). */
      request_delay_seconds: z.number().min(0).max(60),
      demand_keywords: z.array(z.string()),
    }),
    hackernews: z.object({
      enabled: z.boolean(),
      min_points: z.number().int().min(0),
      keywords: z.array(z.string()),
    }),
  }),
  analysis: z.object({
    rank_jump_threshold: z.number().int().positive(),
    growth_threshold_pct: z.number().positive(),
    rating_drop_threshold: z.number().positive(),
    /** Previous rating count must be at least this for fast_growth (tiny apps double on noise). */
    growth_min_rating_count: z.number().int().min(0),
    min_pain_point_frequency: z.number().int().min(1),
    max_apps_for_review_analysis: z.number().int().min(0).max(100),
    apps_per_llm_batch: z.number().int().min(1).max(10),
    max_reviews_per_app_in_prompt: z.number().int().min(10).max(300),
  }),
  llm: z.object({
    cheap_model: z.string(),
    smart_model: z.string(),
    monthly_budget_usd: z.number().positive(),
    concurrency: z.number().int().min(1).max(4),
  }),
  scoring: z.object({
    weights: z.object({
      demand: z.number().min(0),
      competition: z.number().min(0),
      monetization: z.number().min(0),
      effort: z.number().min(0),
    }),
    ideas_per_report: z.number().int().min(1).max(20),
  }),
  notify: z.object({
    telegram: z.object({ enabled: z.boolean() }),
  }),
});

export type IdeaRadarConfig = z.infer<typeof ideaRadarConfigSchema>;

export const DEFAULT_CONFIG: IdeaRadarConfig = {
  profile: {
    role: 'Software engineer, solo, 35 tuổi',
    skills: ['backend', 'mobile cơ bản', 'Flutter'],
    time_per_week_hours: 15,
    budget_usd: 500,
    target_markets: ['us', 'gb', 'au', 'vn'],
    preferred_monetization: ['subscription', 'ads'],
  },
  sources: {
    google_play: {
      enabled: true,
      countries: ['us', 'gb', 'vn'],
      keywords: ['pdf scanner', 'habit tracker', 'ai photo', 'budget', 'translator'],
      seed_apps: [],
      use_top_charts: true,
      chart_categories: ['PRODUCTIVITY', 'TOOLS', 'FINANCE', 'HEALTH_AND_FITNESS', 'EDUCATION', 'PHOTOGRAPHY', 'LIFESTYLE'],
      chart_limit: 50,
      search_limit: 20,
      max_detail_apps: 80,
      max_reviews_per_app: 200,
      request_delay_seconds: 2,
    },
    app_store: {
      enabled: true,
      countries: ['us', 'gb', 'vn'],
      charts: ['top-free', 'top-paid'],
      chart_limit: 100,
      keywords: ['pdf scanner', 'habit tracker', 'ai photo', 'budget', 'translator'],
      search_limit: 20,
      max_reviews_per_app: 200,
      request_delay_seconds: 1,
    },
    reddit: {
      enabled: true,
      subreddits: ['SideProject', 'androiddev', 'iOSProgramming', 'indiehackers', 'startups', 'AppIdeas', 'SomebodyMakeThis'],
      request_delay_seconds: 15,
      demand_keywords: ['mrr', 'revenue', 'i wish there was', 'is there an app', 'would pay', 'looking for an app', 'somebody make'],
    },
    hackernews: {
      enabled: true,
      min_points: 50,
      keywords: ['app', 'mobile', 'side project', 'saas', 'indie'],
    },
  },
  analysis: {
    rank_jump_threshold: 20,
    growth_threshold_pct: 30,
    rating_drop_threshold: 0.3,
    growth_min_rating_count: 50,
    min_pain_point_frequency: 3,
    max_apps_for_review_analysis: 40,
    apps_per_llm_batch: 5,
    max_reviews_per_app_in_prompt: 120,
  },
  llm: {
    cheap_model: 'claude-haiku-5-5',
    smart_model: 'claude-sonnet-5-5',
    monthly_budget_usd: 20,
    concurrency: 2,
  },
  scoring: {
    weights: { demand: 0.35, competition: 0.25, monetization: 0.25, effort: 0.15 },
    ideas_per_report: 8,
  },
  notify: {
    telegram: { enabled: true },
  },
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge `override` onto `base` (arrays and scalars replace). */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override === undefined ? base : override) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in base ? deepMerge((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

/** Stored JSON (possibly partial / older) → full validated config. Throws ZodError on bad values. */
export function resolveConfig(stored: unknown): IdeaRadarConfig {
  return ideaRadarConfigSchema.parse(deepMerge(DEFAULT_CONFIG, stored ?? {}));
}
