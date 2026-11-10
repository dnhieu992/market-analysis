import type { IdeaRadarConfig } from '../config';
import { sleep } from '../http';
import type { AppObservation, Chart, CollectResult, ReviewRecord } from '../types';
import { emptyResult, errMsg, type CollectContext, type Collector, type ReviewTarget } from './base';

/**
 * iOS App Store via Apple's public endpoints (no key):
 *  - charts:  rss.marketingtools.apple.com/api/v2/{cc}/apps/{top-free|top-paid}/{n}/apps.json
 *             (the documented rss.applemarketingtools.com host 301-redirects here)
 *  - details: itunes.apple.com/lookup?id=a,b,c&country=cc (≤ 100 ids per call)
 *  - search:  itunes.apple.com/search?term=…&entity=software&country=cc
 *  - reviews: itunes.apple.com/{cc}/rss/customerreviews/page={p}/id={id}/sortby=mostrecent/json (≤ 10 pages × 50)
 * Apple exposes neither installs nor ads / IAP flags, so those stay null.
 */

const CHART_HOST = 'https://rss.marketingtools.apple.com/api/v2';
const REVIEW_PAGES = 10;

type AppleChartJson = { feed?: { results?: Array<{ id?: string; name?: string; artistName?: string; url?: string; genres?: Array<{ name?: string }> }> } };

type ItunesResult = {
  trackId?: number;
  trackName?: string;
  sellerName?: string;
  primaryGenreName?: string;
  trackViewUrl?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  price?: number;
  currentVersionReleaseDate?: string;
};
type ItunesJson = { results?: ItunesResult[] };

type Label = { label?: string };
type AppleReviewEntry = {
  id?: Label;
  title?: Label;
  content?: Label;
  updated?: Label;
  'im:rating'?: Label;
};
type AppleReviewsJson = { feed?: { entry?: AppleReviewEntry | AppleReviewEntry[] } };

const chartOf = (c: string): Chart => (c === 'top-paid' ? 'top_paid' : 'top_free');

export function parseAppleChart(json: AppleChartJson, country: string, chart: string): AppObservation[] {
  const rows = json.feed?.results ?? [];
  return rows
    .filter((r) => r.id && r.name)
    .map((r, i) => ({
      app: {
        store: 'app_store' as const,
        storeAppId: String(r.id),
        title: String(r.name),
        developer: r.artistName ?? null,
        category: r.genres?.[0]?.name ?? null,
        url: r.url ?? `https://apps.apple.com/${country}/app/id${r.id}`,
      },
      snapshot: { country, chart: chartOf(chart), rank: i + 1 },
    }));
}

/** iTunes lookup / search results keyed by track id. */
export function parseItunesResults(json: ItunesJson): Map<string, ItunesResult> {
  const out = new Map<string, ItunesResult>();
  for (const r of json.results ?? []) if (r.trackId) out.set(String(r.trackId), r);
  return out;
}

export function itunesToObservation(r: ItunesResult, country: string, chart: Chart, rank: number | null): AppObservation | null {
  if (!r.trackId || !r.trackName) return null;
  return {
    app: {
      store: 'app_store',
      storeAppId: String(r.trackId),
      title: r.trackName,
      developer: r.sellerName ?? null,
      category: r.primaryGenreName ?? null,
      url: r.trackViewUrl?.split('?')[0] ?? null,
    },
    snapshot: {
      country,
      chart,
      rank,
      ...detailFields(r),
    },
  };
}

function detailFields(r: ItunesResult) {
  return {
    rating: typeof r.averageUserRating === 'number' ? Number(r.averageUserRating.toFixed(3)) : null,
    ratingCount: typeof r.userRatingCount === 'number' ? r.userRatingCount : null,
    price: typeof r.price === 'number' ? r.price : null,
    updatedOn: r.currentVersionReleaseDate ? new Date(r.currentVersionReleaseDate) : null,
  };
}

/** 1–2★ reviews from one RSS page (the feed sometimes leads with an app-info entry without a rating). */
export function parseAppleReviews(json: AppleReviewsJson, country: string): { reviews: ReviewRecord[]; total: number } {
  const raw = json.feed?.entry;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const reviews: ReviewRecord[] = [];
  let total = 0;
  for (const e of entries) {
    const rating = Number(e['im:rating']?.label);
    const id = e.id?.label;
    if (!id || !Number.isFinite(rating) || rating < 1) continue;
    total += 1;
    if (rating > 2) continue;
    const body = (e.content?.label ?? '').trim();
    if (!body) continue;
    reviews.push({
      storeReviewId: `app_store:${id}`,
      country,
      rating,
      title: e.title?.label?.slice(0, 500) ?? null,
      body: body.slice(0, 4000),
      reviewDate: e.updated?.label ? new Date(e.updated.label) : null,
    });
  }
  return { reviews, total };
}

export class AppStoreCollector implements Collector {
  readonly name = 'app_store';

  enabled(config: IdeaRadarConfig) {
    return config.sources.app_store.enabled;
  }

  async collect(ctx: CollectContext): Promise<CollectResult> {
    const cfg = ctx.config.sources.app_store;
    const result = emptyResult(this.name);
    const delay = cfg.request_delay_seconds * 1000;
    const pause = async (fresh: boolean) => {
      if (fresh && delay) await sleep(delay);
    };

    for (const country of cfg.countries) {
      const observations: AppObservation[] = [];

      for (const chart of cfg.charts) {
        try {
          const { data, fresh } = await ctx.http.getJson<AppleChartJson>(`${CHART_HOST}/${country}/apps/${chart}/${cfg.chart_limit}/apps.json`);
          observations.push(...parseAppleChart(data, country, chart));
          await pause(fresh);
        } catch (err) {
          result.errors.push(`chart ${country}/${chart}: ${errMsg(err)}`);
        }
      }

      // Ratings / price / update date for the chart apps (charts carry only names).
      const ids = [...new Set(observations.map((o) => o.app.storeAppId))];
      const details = new Map<string, ItunesResult>();
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        try {
          const { data, fresh } = await ctx.http.getJson<ItunesJson>(`https://itunes.apple.com/lookup?id=${batch.join(',')}&country=${country}`);
          for (const [id, r] of parseItunesResults(data)) details.set(id, r);
          await pause(fresh);
        } catch (err) {
          result.errors.push(`lookup ${country}: ${errMsg(err)}`);
        }
      }
      for (const o of observations) {
        const d = details.get(o.app.storeAppId);
        if (!d) continue;
        Object.assign(o.snapshot, detailFields(d));
        o.app.category = d.primaryGenreName ?? o.app.category;
        o.app.developer = d.sellerName ?? o.app.developer;
      }

      for (const term of cfg.keywords) {
        try {
          const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${country}&limit=${cfg.search_limit}`;
          const { data, fresh } = await ctx.http.getJson<ItunesJson>(url);
          (data.results ?? []).forEach((r, i) => {
            const o = itunesToObservation(r, country, 'search', i + 1);
            if (o) observations.push(o);
          });
          await pause(fresh);
        } catch (err) {
          result.errors.push(`search ${country}/"${term}": ${errMsg(err)}`);
        }
      }

      if (observations.length) {
        const saved = await ctx.sink.saveObservations(ctx.runId, dedupeObservations(observations));
        result.inserted += saved.inserted;
        result.updated += saved.updated;
      }
      ctx.log(`app_store ${country}: ${observations.length} observations`);
    }
    return result;
  }

  async collectReviews(ctx: CollectContext, targets: ReviewTarget[]): Promise<CollectResult> {
    const cfg = ctx.config.sources.app_store;
    const result = emptyResult(`${this.name}_reviews`);
    const delay = cfg.request_delay_seconds * 1000;

    for (const t of targets.filter((x) => x.store === 'app_store')) {
      for (const country of cfg.countries) {
        const reviews: ReviewRecord[] = [];
        try {
          for (let page = 1; page <= REVIEW_PAGES && reviews.length < cfg.max_reviews_per_app; page++) {
            const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${t.storeAppId}/sortby=mostrecent/json`;
            const { data, fresh } = await ctx.http.getJson<AppleReviewsJson>(url);
            const parsed = parseAppleReviews(data, country);
            reviews.push(...parsed.reviews);
            if (fresh && delay) await sleep(delay);
            if (parsed.total === 0) break; // past the last page
          }
        } catch (err) {
          result.errors.push(`reviews ${t.title} (${country}): ${errMsg(err)}`);
        }
        if (reviews.length) {
          result.inserted += await ctx.sink.saveReviews(ctx.runId, 'app_store', t.storeAppId, reviews.slice(0, cfg.max_reviews_per_app));
        }
      }
    }
    return result;
  }
}

/** Same app twice in one (country, chart, category) — keep the best rank. */
export function dedupeObservations(observations: AppObservation[]): AppObservation[] {
  const best = new Map<string, AppObservation>();
  for (const o of observations) {
    const key = `${o.app.store}|${o.app.storeAppId}|${o.snapshot.country}|${o.snapshot.chart}|${o.snapshot.category ?? ''}`;
    const prev = best.get(key);
    if (!prev || (o.snapshot.rank ?? Infinity) < (prev.snapshot.rank ?? Infinity)) best.set(key, o);
  }
  return [...best.values()];
}
