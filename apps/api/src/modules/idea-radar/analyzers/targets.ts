import type { Store } from '../types';

/**
 * Which apps get their 1–2★ reviews collected + analysed (capped at max_apps_for_review_analysis):
 *  1. apps with a trend signal (rating_drop first — a big app letting users down is the best opening),
 *  2. keyword-search / seed apps (the niches the profile cares about), most-rated first,
 *  3. top-chart apps by best rank.
 * Both stores share the cap evenly (an unused share goes to the other store).
 */

export type TargetApp = { id: string; store: Store; storeAppId: string; title: string; bestRank: number; inSearch: boolean; ratingCount: number };
export type TargetSignal = { appId: string; signalType: string };

const SIGNAL_PRIORITY: Record<string, number> = { rating_drop: 0, rank_jump: 1, fast_growth: 2, new_entry: 3 };

export function pickReviewTargets(apps: TargetApp[], signals: TargetSignal[], max: number): TargetApp[] {
  if (max <= 0) return [];
  const signalRank = new Map<string, number>();
  for (const s of signals) {
    const p = SIGNAL_PRIORITY[s.signalType] ?? 9;
    signalRank.set(s.appId, Math.min(signalRank.get(s.appId) ?? 9, p));
  }
  const tier = (a: TargetApp) => (signalRank.has(a.id) ? 0 : a.inSearch ? 1 : 2);
  const ordered = [...apps].sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t) return t;
    if (tier(a) === 0) return (signalRank.get(a.id) ?? 9) - (signalRank.get(b.id) ?? 9) || b.ratingCount - a.ratingCount;
    if (tier(a) === 1) return b.ratingCount - a.ratingCount;
    return a.bestRank - b.bestRank;
  });

  const byStore = new Map<Store, TargetApp[]>();
  for (const a of ordered) byStore.set(a.store, [...(byStore.get(a.store) ?? []), a]);
  const stores = [...byStore.keys()];
  const picked: TargetApp[] = [];
  // Round-robin across stores keeps the split even and lets one store use the other's unused share.
  for (let i = 0; picked.length < max; i++) {
    let added = false;
    for (const s of stores) {
      const a = byStore.get(s)?.[i];
      if (a && picked.length < max) {
        picked.push(a);
        added = true;
      }
    }
    if (!added) break;
  }
  return picked;
}
