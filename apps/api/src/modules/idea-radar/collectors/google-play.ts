import type gplayModule from 'google-play-scraper';

import type { IdeaRadarConfig } from '../config';
import { sleep } from '../http';
import type { AppObservation, CollectResult, ReviewRecord } from '../types';
import { dedupeObservations } from './app-store';
import { emptyResult, errMsg, type CollectContext, type Collector, type ReviewTarget } from './base';

/**
 * Google Play has no official charts API — this uses the unofficial `google-play-scraper` (v10, ESM-only,
 * scrapes play.google.com, so it can break when Google changes the page). Apps come from keyword search,
 * seed apps and (feature flag `use_top_charts`) category top charts. Detail pages (installs, ads, IAP,
 * rating count) are fetched for at most `max_detail_apps` apps — that is the slow part.
 */

// ESM-only package — load lazily so the CommonJS build (and jest) only touch it at call time.
type Gplay = typeof gplayModule;
let gplayPromise: Promise<Gplay> | null = null;
const loadGplay = () => (gplayPromise ??= import('google-play-scraper').then((m) => m.default));
// The bundled typings declare `collection` / `sort` as enum *types*; at runtime they are plain objects.
const constants = (g: Gplay) => g as unknown as { collection: Record<'TOP_FREE' | 'TOP_PAID', string>; sort: Record<'NEWEST', number> };

type ListItem = { appId?: string; title?: string; developer?: string; score?: number; price?: number; url?: string; genre?: string };
type AppDetail = {
  appId: string;
  title: string;
  developer?: string;
  genre?: string;
  url?: string;
  maxInstalls?: number;
  score?: number;
  ratings?: number;
  price?: number;
  adSupported?: boolean;
  offersIAP?: boolean;
  updated?: number;
};
type GplayReview = { id?: string; score?: number; title?: string | null; text?: string | null; date?: string };

export function listToObservations(items: ListItem[], country: string, chart: AppObservation['snapshot']['chart'], category = ''): AppObservation[] {
  return items
    .filter((a) => a.appId && a.title)
    .map((a, i) => ({
      app: {
        store: 'google_play' as const,
        storeAppId: String(a.appId),
        title: String(a.title),
        developer: a.developer ?? null,
        category: a.genre ?? (category || null),
        url: a.url ?? `https://play.google.com/store/apps/details?id=${a.appId}`,
      },
      snapshot: {
        country,
        chart,
        category,
        rank: i + 1,
        rating: typeof a.score === 'number' && a.score > 0 ? Number(a.score.toFixed(3)) : null,
        price: typeof a.price === 'number' ? a.price : null,
      },
    }));
}

export function detailFields(d: AppDetail) {
  return {
    installs: typeof d.maxInstalls === 'number' ? d.maxInstalls : null,
    rating: typeof d.score === 'number' && d.score > 0 ? Number(d.score.toFixed(3)) : null,
    ratingCount: typeof d.ratings === 'number' ? d.ratings : null,
    price: typeof d.price === 'number' ? d.price : null,
    hasAds: typeof d.adSupported === 'boolean' ? d.adSupported : null,
    hasIap: typeof d.offersIAP === 'boolean' ? d.offersIAP : null,
    updatedOn: typeof d.updated === 'number' ? new Date(d.updated) : null,
  };
}

/** Newest reviews → only 1–2★, capped. No user names are kept. */
export function parseGplayReviews(rows: GplayReview[], country: string, max: number): ReviewRecord[] {
  const out: ReviewRecord[] = [];
  for (const r of rows) {
    if (!r.id || typeof r.score !== 'number' || r.score > 2 || !r.text?.trim()) continue;
    out.push({
      storeReviewId: `google_play:${r.id}`,
      country,
      rating: r.score,
      title: r.title ?? null,
      body: r.text.trim().slice(0, 4000),
      reviewDate: r.date ? new Date(r.date) : null,
    });
    if (out.length >= max) break;
  }
  return out;
}

export class GooglePlayCollector implements Collector {
  readonly name = 'google_play';

  constructor(private readonly load: () => Promise<Gplay> = loadGplay) {}

  enabled(config: IdeaRadarConfig) {
    return config.sources.google_play.enabled;
  }

  async collect(ctx: CollectContext): Promise<CollectResult> {
    const cfg = ctx.config.sources.google_play;
    const result = emptyResult(this.name);
    const gplay = await this.load();
    const delay = cfg.request_delay_seconds * 1000;
    const call = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      const { data, fresh } = await ctx.http.cached(`gplay:${key}`, fn);
      if (fresh && delay) await sleep(delay);
      return data;
    };

    const observations: AppObservation[] = [];
    for (const country of cfg.countries) {
      if (cfg.use_top_charts) {
        for (const category of cfg.chart_categories) {
          for (const [collection, chart] of [
            [constants(gplay).collection.TOP_FREE, 'top_free'],
            [constants(gplay).collection.TOP_PAID, 'top_paid'],
          ] as const) {
            try {
              const items = await call(`list:${country}:${category}:${collection}:${cfg.chart_limit}`, () =>
                gplay.list({ collection: collection as never, category: category as never, num: cfg.chart_limit, country }) as Promise<ListItem[]>,
              );
              observations.push(...listToObservations(items, country, chart, category));
            } catch (err) {
              result.errors.push(`chart ${country}/${category}/${chart}: ${errMsg(err)}`);
            }
          }
        }
      }
      for (const term of cfg.keywords) {
        try {
          const items = await call(`search:${country}:${term}:${cfg.search_limit}`, () =>
            gplay.search({ term, num: cfg.search_limit, country }) as Promise<ListItem[]>,
          );
          observations.push(...listToObservations(items, country, 'search'));
        } catch (err) {
          result.errors.push(`search ${country}/"${term}": ${errMsg(err)}`);
        }
      }
    }

    // Detail pages: seeds first, then search hits, then the top of each chart.
    const primary = cfg.countries[0] ?? 'us';
    const priority = (o: AppObservation) => (o.snapshot.chart === 'search' ? 0 : 1) * 1000 + (o.snapshot.rank ?? 999);
    const detailIds = [
      ...new Set([
        ...cfg.seed_apps,
        ...[...observations].sort((a, b) => priority(a) - priority(b)).map((o) => o.app.storeAppId),
      ]),
    ].slice(0, Math.max(cfg.max_detail_apps, cfg.seed_apps.length));

    const details = new Map<string, AppDetail>();
    for (const appId of detailIds) {
      try {
        details.set(appId, await call(`app:${primary}:${appId}`, () => gplay.app({ appId, country: primary }) as Promise<AppDetail>));
      } catch (err) {
        result.errors.push(`app ${appId}: ${errMsg(err)}`);
      }
    }

    // Play ratings / installs are global, so one detail page fills every country's rows of that app.
    for (const o of observations) {
      const d = details.get(o.app.storeAppId);
      if (!d) continue;
      Object.assign(o.snapshot, { ...detailFields(d), rank: o.snapshot.rank });
      o.app.category = d.genre ?? o.app.category;
      o.app.developer = d.developer ?? o.app.developer;
    }
    for (const appId of cfg.seed_apps) {
      const d = details.get(appId);
      if (!d) continue;
      observations.push({
        app: { store: 'google_play', storeAppId: appId, title: d.title, developer: d.developer ?? null, category: d.genre ?? null, url: d.url ?? null },
        snapshot: { country: primary, chart: 'seed', rank: null, ...detailFields(d) },
      });
    }

    if (observations.length) {
      const saved = await ctx.sink.saveObservations(ctx.runId, dedupeObservations(observations));
      result.inserted += saved.inserted;
      result.updated += saved.updated;
    }
    ctx.log(`google_play: ${observations.length} observations, ${details.size} detail pages`);
    return result;
  }

  async collectReviews(ctx: CollectContext, targets: ReviewTarget[]): Promise<CollectResult> {
    const cfg = ctx.config.sources.google_play;
    const result = emptyResult(`${this.name}_reviews`);
    const gplay = await this.load();
    const delay = cfg.request_delay_seconds * 1000;

    for (const t of targets.filter((x) => x.store === 'google_play')) {
      for (const country of cfg.countries) {
        try {
          // Newest first; fetch ~3× the cap since most recent reviews are 3–5★.
          const num = Math.min(1000, cfg.max_reviews_per_app * 3);
          const { data, fresh } = await ctx.http.cached(`gplay:reviews:${country}:${t.storeAppId}:${num}`, async () => {
            const r = (await gplay.reviews({ appId: t.storeAppId, country, sort: constants(gplay).sort.NEWEST as never, num })) as { data?: GplayReview[] };
            return (r.data ?? []).map((x) => ({ id: x.id, score: x.score, title: x.title, text: x.text, date: x.date }));
          });
          const reviews = parseGplayReviews(data, country, cfg.max_reviews_per_app);
          if (reviews.length) result.inserted += await ctx.sink.saveReviews(ctx.runId, 'google_play', t.storeAppId, reviews);
          if (fresh && delay) await sleep(delay);
        } catch (err) {
          result.errors.push(`reviews ${t.title} (${country}): ${errMsg(err)}`);
        }
      }
    }
    return result;
  }
}
