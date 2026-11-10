import type { IdeaRadarConfig } from '../config';
import { HttpError, sleep } from '../http';
import type { CollectResult, PostRecord } from '../types';
import { emptyResult, errMsg, htmlToText, type CollectContext, type Collector } from './base';

/**
 * Reddit via the public Atom feeds (/r/{sub}/top/.rss?t=week and /new/.rss).
 * Why not the API: new Reddit API apps need manual approval, and unauthenticated .json is 403 from
 * server IPs. The feeds carry no score / comment count and are rate-limited hard (429 after a few
 * quick calls), so requests are spaced out and a failing subreddit is just recorded as an error.
 */

const MAX_AGE_MS = 7 * 86_400_000;
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.IDEA_RADAR_REDDIT_COOLDOWN_MS ?? 60_000);

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m?.[1]?.trim() ?? null;
};
const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function parseRedditAtom(xml: string, subreddit: string, feed: 'top' | 'new', demandKeywords: string[]): PostRecord[] {
  const out: PostRecord[] = [];
  for (const chunk of xml.split('<entry>').slice(1)) {
    const entry = chunk.split('</entry>')[0] ?? '';
    const id = tag(entry, 'id');
    const title = tag(entry, 'title');
    const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
    const date = tag(entry, 'published') ?? tag(entry, 'updated');
    if (!id || !title || !link || !date) continue;
    const body = htmlToText(decodeXml(tag(entry, 'content') ?? ''))
      .replace(/submitted by\s+\/u\/\S+.*$/s, '') // footer with the author's name — not kept
      .trim();
    const text = `${decodeXml(title)} ${body}`.toLowerCase();
    out.push({
      source: 'reddit',
      externalId: `reddit:${id}`,
      title: htmlToText(decodeXml(title)).slice(0, 500),
      body: body.slice(0, 4000) || null,
      url: decodeXml(link),
      score: null,
      numComments: null,
      postedAt: new Date(date),
      extra: { subreddit, feed, demandMatch: demandKeywords.filter((k) => text.includes(k.toLowerCase())) },
    });
  }
  return out;
}

export class RedditCollector implements Collector {
  readonly name = 'reddit';

  enabled(config: IdeaRadarConfig) {
    return config.sources.reddit.enabled;
  }

  async collect(ctx: CollectContext): Promise<CollectResult> {
    const cfg = ctx.config.sources.reddit;
    const result = emptyResult(this.name);
    const posts = new Map<string, PostRecord>();
    const cutoff = Date.now() - MAX_AGE_MS;

    for (const sub of cfg.subreddits) {
      for (const feed of ['top', 'new'] as const) {
        const url = feed === 'top' ? `https://www.reddit.com/r/${sub}/top/.rss?t=week&limit=50` : `https://www.reddit.com/r/${sub}/new/.rss?limit=50`;
        // The shared client's short backoff isn't enough for Reddit's 429s: cool down a minute and try again.
        for (let attempt = 0; ; attempt++) {
          try {
            const { body, fresh } = await ctx.http.getText(url);
            for (const p of parseRedditAtom(body, sub, feed, cfg.demand_keywords)) {
              if (p.postedAt.getTime() >= cutoff && !posts.has(p.externalId)) posts.set(p.externalId, p);
            }
            if (fresh) await sleep(cfg.request_delay_seconds * 1000);
            break;
          } catch (err) {
            if (err instanceof HttpError && err.status === 429 && attempt < RATE_LIMIT_RETRIES) {
              await sleep(RATE_LIMIT_COOLDOWN_MS);
              continue;
            }
            result.errors.push(`r/${sub} ${feed}: ${errMsg(err)}`);
            await sleep(cfg.request_delay_seconds * 2000);
            break;
          }
        }
      }
    }

    if (posts.size) {
      const saved = await ctx.sink.savePosts(ctx.runId, [...posts.values()]);
      result.inserted += saved.inserted;
      result.updated += saved.updated;
    }
    ctx.log(`reddit: ${posts.size} posts`);
    return result;
  }
}
