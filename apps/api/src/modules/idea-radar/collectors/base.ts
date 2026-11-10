import type { IdeaRadarConfig } from '../config';
import type { HttpClient } from '../http';
import type { AppObservation, CollectResult, PostRecord, ReviewRecord, Store } from '../types';

/** Where collectors write (the Prisma store in prod, an in-memory fake in tests). */
export interface CollectorSink {
  /** Upsert apps + this run's snapshots. Returns counts of new / updated snapshot rows. */
  saveObservations(runId: string, observations: AppObservation[]): Promise<{ inserted: number; updated: number }>;
  /** Insert 1–2★ reviews (deduped on storeReviewId). Returns how many were new. */
  saveReviews(runId: string, store: Store, storeAppId: string, reviews: ReviewRecord[]): Promise<number>;
  /** Upsert posts (deduped on externalId; score / comments refreshed). */
  savePosts(runId: string, posts: PostRecord[]): Promise<{ inserted: number; updated: number }>;
}

export type CollectContext = {
  runId: string;
  config: IdeaRadarConfig;
  http: HttpClient;
  sink: CollectorSink;
  log: (msg: string) => void;
};

export type ReviewTarget = { store: Store; storeAppId: string; title: string };

export interface Collector {
  readonly name: string;
  enabled(config: IdeaRadarConfig): boolean;
  /** Listings, snapshots, posts. */
  collect(ctx: CollectContext): Promise<CollectResult>;
  /** Store collectors only: newest 1–2★ reviews for the chosen apps. */
  collectReviews?(ctx: CollectContext, targets: ReviewTarget[]): Promise<CollectResult>;
}

export const emptyResult = (source: string): CollectResult => ({ source, inserted: 0, updated: 0, errors: [] });

export const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** Strip tags / entities and collapse whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
