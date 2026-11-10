import type { IdeaRadarConfig } from '../config';
import { sleep } from '../http';
import type { CollectResult, PostRecord } from '../types';
import { emptyResult, errMsg, htmlToText, type CollectContext, type Collector } from './base';

/** Hacker News via the Algolia search API (free, no key): Show HN + keyword stories of the last 7 days. */

const API = 'https://hn.algolia.com/api/v1';

type HnHit = {
  objectID?: string;
  title?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at_i?: number;
  story_text?: string | null;
  _tags?: string[];
};
type HnJson = { hits?: HnHit[] };

export function parseHnHits(json: HnJson, minPoints: number): PostRecord[] {
  return (json.hits ?? [])
    .filter((h) => h.objectID && h.title && (h.points ?? 0) >= minPoints)
    .map((h) => {
      const hnUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
      return {
        source: 'hn' as const,
        externalId: `hn:${h.objectID}`,
        title: String(h.title).slice(0, 500),
        body: h.story_text ? htmlToText(h.story_text).slice(0, 4000) : null,
        url: hnUrl,
        score: h.points ?? null,
        numComments: h.num_comments ?? null,
        postedAt: new Date((h.created_at_i ?? 0) * 1000),
        extra: { link: h.url ?? null, showHn: (h._tags ?? []).includes('show_hn') },
      };
    });
}

export class HackerNewsCollector implements Collector {
  readonly name = 'hackernews';

  enabled(config: IdeaRadarConfig) {
    return config.sources.hackernews.enabled;
  }

  async collect(ctx: CollectContext): Promise<CollectResult> {
    const cfg = ctx.config.sources.hackernews;
    const result = emptyResult(this.name);
    const since = Math.floor(Date.now() / 1000) - 7 * 86_400;
    const filters = encodeURIComponent(`points>${cfg.min_points},created_at_i>${since}`);

    const urls = [
      `${API}/search_by_date?tags=show_hn&numericFilters=${filters}&hitsPerPage=100`,
      ...cfg.keywords.map((k) => `${API}/search?query=${encodeURIComponent(k)}&tags=story&numericFilters=${filters}&hitsPerPage=50`),
    ];

    const posts = new Map<string, PostRecord>();
    for (const url of urls) {
      try {
        const { data, fresh } = await ctx.http.getJson<HnJson>(url);
        for (const p of parseHnHits(data, cfg.min_points)) posts.set(p.externalId, p);
        if (fresh) await sleep(300);
      } catch (err) {
        result.errors.push(`${url.includes('show_hn') ? 'show_hn' : 'search'}: ${errMsg(err)}`);
      }
    }

    if (posts.size) {
      const saved = await ctx.sink.savePosts(ctx.runId, [...posts.values()]);
      result.inserted += saved.inserted;
      result.updated += saved.updated;
    }
    ctx.log(`hackernews: ${posts.size} posts`);
    return result;
  }
}
