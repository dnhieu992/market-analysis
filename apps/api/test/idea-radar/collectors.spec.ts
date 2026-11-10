import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppStoreCollector, dedupeObservations, itunesToObservation, parseAppleChart, parseAppleReviews, parseItunesResults } from '../../src/modules/idea-radar/collectors/app-store';
import { htmlToText, type CollectContext, type CollectorSink } from '../../src/modules/idea-radar/collectors/base';
import { GooglePlayCollector, listToObservations, parseGplayReviews } from '../../src/modules/idea-radar/collectors/google-play';
import { HackerNewsCollector, parseHnHits } from '../../src/modules/idea-radar/collectors/hackernews';
import { parseRedditAtom, RedditCollector } from '../../src/modules/idea-radar/collectors/reddit';
import { DEFAULT_CONFIG, deepMerge, type IdeaRadarConfig } from '../../src/modules/idea-radar/config';
import { HttpClient, HttpError, withRetry } from '../../src/modules/idea-radar/http';
import type { AppObservation, PostRecord, ReviewRecord } from '../../src/modules/idea-radar/types';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'idea-radar', name), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));

class MemorySink implements CollectorSink {
  observations: AppObservation[] = [];
  reviews: Array<{ storeAppId: string; review: ReviewRecord }> = [];
  posts: PostRecord[] = [];
  async saveObservations(_runId: string, obs: AppObservation[]) {
    this.observations.push(...obs);
    return { inserted: obs.length, updated: 0 };
  }
  async saveReviews(_runId: string, _store: string, storeAppId: string, reviews: ReviewRecord[]) {
    this.reviews.push(...reviews.map((review) => ({ storeAppId, review })));
    return reviews.length;
  }
  async savePosts(_runId: string, posts: PostRecord[]) {
    this.posts.push(...posts);
    return { inserted: posts.length, updated: 0 };
  }
}

/** Routes URLs to canned responses by substring. */
function fakeFetch(routes: Array<[string, string | (() => Response)]>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const hit = routes.find(([k]) => url.includes(k));
    if (!hit) return new Response('not found', { status: 404 });
    return typeof hit[1] === 'string' ? new Response(hit[1]) : hit[1]();
  };
  return Object.assign(fn, { calls });
}

const ctxWith = (config: IdeaRadarConfig, fetchImpl: ReturnType<typeof fakeFetch>) => {
  const sink = new MemorySink();
  const ctx: CollectContext = {
    runId: 'run1',
    config,
    http: new HttpClient({ fetchImpl, cacheDir: null, retry: { retries: 1, baseDelayMs: 1 } }),
    sink,
    log: () => undefined,
  };
  return { ctx, sink };
};

const cfg = (override: unknown) => deepMerge(DEFAULT_CONFIG, override);

describe('App Store parsing (fixtures)', () => {
  it('parses a chart with ranks', () => {
    const obs = parseAppleChart(json('apple-chart.json'), 'us', 'top-free');
    expect(obs).toHaveLength(5);
    expect(obs[0]).toMatchObject({ app: { store: 'app_store', storeAppId: '6741796873', title: 'TikTok Pro - Events' }, snapshot: { country: 'us', chart: 'top_free', rank: 1 } });
    expect(parseAppleChart({}, 'us', 'top-paid')).toEqual([]);
  });

  it('parses lookup results into snapshot fields', () => {
    const map = parseItunesResults(json('itunes-lookup.json'));
    const wa = map.get('310633997');
    expect(wa?.trackName).toBe('WhatsApp');
    const o = itunesToObservation(wa!, 'us', 'search', 3);
    expect(o?.snapshot).toMatchObject({ chart: 'search', rank: 3, price: 0 });
    expect(o?.snapshot.rating).toBeGreaterThan(1);
    expect(o?.snapshot.ratingCount).toBeGreaterThan(1000);
    expect(itunesToObservation({}, 'us', 'search', 1)).toBeNull();
  });

  it('keeps only 1–2★ reviews, without author names', () => {
    const { reviews, total } = parseAppleReviews(json('apple-reviews.json'), 'us');
    expect(total).toBe(8);
    expect(reviews.every((r) => r.rating <= 2)).toBe(true);
    for (const r of reviews) {
      expect(r.storeReviewId).toMatch(/^app_store:\d+$/);
      expect(JSON.stringify(r)).not.toContain('redacted');
    }
    // A single (non-array) entry and an app-info entry without rating.
    const single = parseAppleReviews({ feed: { entry: { id: { label: '9' }, 'im:rating': { label: '1' }, content: { label: 'bad' } } } }, 'gb');
    expect(single.reviews).toHaveLength(1);
    expect(parseAppleReviews({ feed: { entry: [{ id: { label: 'app' } }] } }, 'us')).toEqual({ reviews: [], total: 0 });
  });

  it('dedupes by best rank', () => {
    const a = parseAppleChart(json('apple-chart.json'), 'us', 'top-free');
    const dup = { ...a[3]!, snapshot: { ...a[3]!.snapshot, rank: 50 } };
    expect(dedupeObservations([...a, dup])).toHaveLength(5);
    expect(dedupeObservations([dup, a[3]!])[0]?.snapshot.rank).toBe(4);
  });
});

describe('AppStoreCollector', () => {
  const config = cfg({ sources: { app_store: { countries: ['us'], charts: ['top-free'], keywords: ['scanner'], request_delay_seconds: 0, max_reviews_per_app: 5 } } });

  it('collects chart + lookup + search, and keeps going when one call fails', async () => {
    const fetchImpl = fakeFetch([
      ['/apps/top-free/', fixture('apple-chart.json')],
      ['/lookup?', fixture('itunes-lookup.json')],
      ['/search?', () => new Response('boom', { status: 500 })],
    ]);
    const { ctx, sink } = ctxWith(config, fetchImpl);
    const r = await new AppStoreCollector().collect(ctx);
    expect(r.inserted).toBe(5);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/search us\/"scanner": HTTP 500/);
    // Lookup enriched the chart row that matched.
    const first = sink.observations.find((o) => o.app.storeAppId === '6741796873');
    expect(first?.snapshot.rank).toBe(1);
  });

  it('collects reviews page by page until the cap', async () => {
    const fetchImpl = fakeFetch([['customerreviews/page=', fixture('apple-reviews.json')]]);
    const { ctx, sink } = ctxWith(config, fetchImpl);
    const r = await new AppStoreCollector().collectReviews(ctx, [
      { store: 'app_store', storeAppId: '310633997', title: 'WhatsApp' },
      { store: 'google_play', storeAppId: 'ignored', title: 'x' },
    ]);
    const perPage = parseAppleReviews(json('apple-reviews.json'), 'us').reviews.length;
    expect(r.errors).toEqual([]);
    expect(sink.reviews.length).toBe(Math.min(5, perPage * 10));
    expect(fetchImpl.calls.every((u) => u.includes('id=310633997'))).toBe(true);
  });
});

describe('Hacker News', () => {
  it('parses hits above min points and links to the HN thread', () => {
    const posts = parseHnHits(json('hn.json'), 50);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]?.externalId).toMatch(/^hn:\d+$/);
    expect(posts[0]?.url).toMatch(/^https:\/\/news\.ycombinator\.com\/item\?id=\d+$/);
    expect(parseHnHits(json('hn.json'), 1_000_000)).toEqual([]);
  });

  it('collects show_hn + keyword searches, deduped', async () => {
    const fetchImpl = fakeFetch([['hn.algolia.com', fixture('hn.json')]]);
    const { ctx, sink } = ctxWith(cfg({ sources: { hackernews: { keywords: ['app'] } } }), fetchImpl);
    await new HackerNewsCollector().collect(ctx);
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.calls[0]).toContain('tags=show_hn');
    expect(fetchImpl.calls[0]).toContain(encodeURIComponent('points>50'));
    expect(sink.posts.length).toBe(parseHnHits(json('hn.json'), 50).length);
  });
});

describe('Reddit (RSS)', () => {
  const atom = () => fixture('reddit-top.atom').replace(/__NOW__/g, new Date().toISOString());

  it('parses Atom entries without the author footer, with demand keywords', () => {
    const posts = parseRedditAtom(atom(), 'SomebodyMakeThis', 'top', ['is there an app', 'would pay', 'mrr']);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      source: 'reddit',
      externalId: 'reddit:t3_1abc123',
      title: 'Receipt splitter & no subscription',
      url: 'https://www.reddit.com/r/SomebodyMakeThis/comments/1abc123/receipt_app/',
      score: null,
      extra: { subreddit: 'SomebodyMakeThis', feed: 'top', demandMatch: ['is there an app', 'would pay'] },
    });
    expect(posts[0]?.body).toContain('scans receipts & splits bills');
    expect(posts[0]?.body).not.toContain('/u/someone');
  });

  it('keeps only last-7-day posts and records failing subreddits', async () => {
    const fetchImpl = fakeFetch([
      ['/r/AppIdeas/', atom()],
      ['/r/Broken/', () => new Response('', { status: 403 })],
    ]);
    const { ctx, sink } = ctxWith(cfg({ sources: { reddit: { subreddits: ['AppIdeas', 'Broken'], request_delay_seconds: 0 } } }), fetchImpl);
    const r = await new RedditCollector().collect(ctx);
    expect(sink.posts.map((p) => p.externalId)).toEqual(['reddit:t3_1abc123']);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/r\/Broken top: HTTP 403/);
  });
});

describe('Google Play', () => {
  const list = [
    { appId: 'com.a', title: 'A Scanner', developer: 'Dev A', score: 4.5123, price: 0, url: 'https://play.google.com/store/apps/details?id=com.a' },
    { appId: 'com.b', title: 'B Habit', score: 0, price: 1.99 },
    { title: 'no id' },
  ];

  it('maps list / search items to ranked observations', () => {
    const obs = listToObservations(list, 'us', 'top_free', 'TOOLS');
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({ app: { storeAppId: 'com.a', category: 'TOOLS' }, snapshot: { rank: 1, rating: 4.512, category: 'TOOLS' } });
    expect(obs[1]?.snapshot.rating).toBeNull();
  });

  it('keeps 1–2★ reviews only, capped', () => {
    const rows = [
      { id: '1', score: 1, text: 'ads ads', date: '2026-11-01T00:00:00Z' },
      { id: '2', score: 5, text: 'great' },
      { id: '3', score: 2, text: '   ' },
      { id: '4', score: 2, text: 'paywall' },
      { id: '5', score: 1, text: 'third' },
    ];
    const out = parseGplayReviews(rows, 'gb', 2);
    expect(out.map((r) => r.storeReviewId)).toEqual(['google_play:1', 'google_play:4']);
    expect(out[0]?.reviewDate?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('collects charts, search, details and reviews through the scraper', async () => {
    const gplay = {
      collection: { TOP_FREE: 'TOP_FREE', TOP_PAID: 'TOP_PAID' },
      sort: { NEWEST: 2 },
      list: jest.fn(async () => list),
      search: jest.fn(async () => [list[1]]),
      app: jest.fn(async ({ appId }: { appId: string }) => ({ appId, title: appId, maxInstalls: 12345, score: 4.1, ratings: 900, adSupported: true, offersIAP: false, updated: 1_700_000_000_000 })),
      reviews: jest.fn(async () => ({ data: [{ id: 'r1', score: 1, text: 'crash', userName: 'Secret Name' }] })),
    };
    const config = cfg({
      sources: { google_play: { countries: ['us'], chart_categories: ['TOOLS'], keywords: ['habit'], seed_apps: ['com.seed'], max_detail_apps: 2, request_delay_seconds: 0 } },
    });
    const fetchImpl = fakeFetch([]);
    const { ctx, sink } = ctxWith(config, fetchImpl);
    const c = new GooglePlayCollector(async () => gplay as never);
    const r = await c.collect(ctx);
    expect(r.errors).toEqual([]);
    expect(gplay.list).toHaveBeenCalledTimes(2); // free + paid
    expect(gplay.app).toHaveBeenCalledTimes(2); // seed + 1 more (max_detail_apps)
    const b = sink.observations.find((o) => o.app.storeAppId === 'com.b' && o.snapshot.chart === 'search');
    expect(b?.snapshot).toMatchObject({ rank: 1, installs: 12345, ratingCount: 900, hasAds: true, hasIap: false });
    expect(sink.observations.some((o) => o.snapshot.chart === 'seed' && o.app.storeAppId === 'com.seed')).toBe(true);

    await c.collectReviews(ctx, [{ store: 'google_play', storeAppId: 'com.a', title: 'A' }]);
    expect(sink.reviews).toHaveLength(1);
    expect(JSON.stringify(sink.reviews)).not.toContain('Secret Name');
  });

  it('records scraper failures per call', async () => {
    const gplay = {
      collection: { TOP_FREE: 'TOP_FREE', TOP_PAID: 'TOP_PAID' },
      sort: { NEWEST: 2 },
      list: jest.fn(async () => {
        throw new Error('page changed');
      }),
      search: jest.fn(async () => []),
      app: jest.fn(),
      reviews: jest.fn(async () => {
        throw new Error('blocked');
      }),
    };
    const config = cfg({ sources: { google_play: { countries: ['us'], chart_categories: ['TOOLS'], keywords: [], request_delay_seconds: 0 } } });
    const { ctx } = ctxWith(config, fakeFetch([]));
    const c = new GooglePlayCollector(async () => gplay as never);
    const r = await c.collect(ctx);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/page changed/);
    const rr = await c.collectReviews(ctx, [{ store: 'google_play', storeAppId: 'com.a', title: 'A' }]);
    expect(rr.errors[0]).toMatch(/blocked/);
  });
});

describe('http helpers', () => {
  it('retries 5xx / 429 but not 4xx', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpError(503, 'u');
        },
        { retries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('HTTP 503');
    expect(n).toBe(3);

    n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpError(404, 'u');
        },
        { retries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('HTTP 404');
    expect(n).toBe(1);

    n = 0;
    expect(await withRetry(async () => (++n < 2 ? Promise.reject(new HttpError(429, 'u')) : 'ok'), { retries: 3, baseDelayMs: 1 })).toBe('ok');
  });

  it('caches by day on disk', async () => {
    const dir = join(tmpdir(), `idea-radar-test-${Date.now()}`);
    const fetchImpl = fakeFetch([['x.test', '{"a":1}']]);
    const http = new HttpClient({ fetchImpl, cacheDir: dir });
    expect(await http.getJson('https://x.test/a')).toEqual({ data: { a: 1 }, fresh: true });
    expect(await http.getJson('https://x.test/a')).toEqual({ data: { a: 1 }, fresh: false });
    expect(fetchImpl.calls).toHaveLength(1);
    const calls = jest.fn(async () => [1, 2]);
    expect((await http.cached('k', calls)).fresh).toBe(true);
    expect((await http.cached('k', calls)).data).toEqual([1, 2]);
    expect(calls).toHaveBeenCalledTimes(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('htmlToText decodes entities', () => {
    expect(htmlToText('<p>a &amp; b&#39;s&nbsp;<b>x</b></p><br/>c &#x41;')).toBe("a & b's x\nc A");
  });
});
