/** Normalized records the collectors hand to the store (source-specific parsing lives in each collector). */

export type Store = 'google_play' | 'app_store';
export type Chart = 'top_free' | 'top_paid' | 'search' | 'seed';

export type AppRecord = {
  store: Store;
  storeAppId: string;
  title: string;
  developer?: string | null;
  category?: string | null;
  url?: string | null;
};

export type SnapshotRecord = {
  country: string;
  chart: Chart;
  /** Google Play chart category ('' for App Store charts, search and seed). */
  category?: string;
  rank?: number | null;
  installs?: number | null;
  rating?: number | null;
  ratingCount?: number | null;
  price?: number | null;
  hasAds?: boolean | null;
  hasIap?: boolean | null;
  updatedOn?: Date | null;
};

export type AppObservation = { app: AppRecord; snapshot: SnapshotRecord };

export type ReviewRecord = {
  storeReviewId: string;
  country: string;
  rating: number;
  title?: string | null;
  body: string;
  reviewDate?: Date | null;
};

export type PostRecord = {
  source: 'reddit' | 'hn' | 'producthunt';
  externalId: string;
  title: string;
  body?: string | null;
  url: string;
  score?: number | null;
  numComments?: number | null;
  postedAt: Date;
  extra?: Record<string, unknown>;
};

export type CollectResult = {
  source: string;
  inserted: number;
  updated: number;
  errors: string[];
};

export type RunError = { source: string; message: string };

export type PainCategory =
  | 'ads_too_many'
  | 'paywall'
  | 'missing_feature'
  | 'bugs_crash'
  | 'privacy'
  | 'ux'
  | 'performance'
  | 'other';

export const PAIN_CATEGORIES: readonly PainCategory[] = [
  'ads_too_many',
  'paywall',
  'missing_feature',
  'bugs_crash',
  'privacy',
  'ux',
  'performance',
  'other',
];

export type SignalType = 'new_entry' | 'rank_jump' | 'rating_drop' | 'fast_growth';

export type MonetizationModel = 'ads' | 'subscription' | 'iap' | 'paid' | 'hybrid';

export type IdeaStatus = 'new' | 'repeat' | 'dismissed' | 'shortlisted';
export const IDEA_STATUSES: readonly IdeaStatus[] = ['new', 'repeat', 'dismissed', 'shortlisted'];

export type EvidenceRef = {
  type: 'pain_point' | 'trend_signal' | 'post';
  id: string;
  label: string;
  url: string | null;
};
