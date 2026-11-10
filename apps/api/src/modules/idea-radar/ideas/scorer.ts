/**
 * Scorer: the LLM's raw 1–5 scores, adjusted by hard evidence, then weighted.
 *
 *   demand       + up to 1 for many independent refs / high review frequency, −0.5 with < 2 refs
 *   competition  −1 when a known competitor is a strong incumbent (rating ≥ 4.5 and ≥ 100k ratings),
 *                +0.5 when every known competitor is weak (rating < 3.8) or one is dropping (rating_drop)
 *   monetization, effort — LLM only
 *   total        Σ weight × score (weights from config), 2 decimals
 */

export type RawScores = { demand: number; competition: number; monetization: number; effort: number };
export type Weights = RawScores;

export type ScoreEvidence = {
  /** Pain points cited by the idea. */
  painPoints: Array<{ frequency: number; severity: number }>;
  signalCount: number;
  postCount: number;
  /** Competitors we could match to tracked apps (latest snapshot). */
  competitors: Array<{ rating: number | null; ratingCount: number | null; ratingDrop: boolean }>;
};

export type FinalScores = RawScores & { total: number };

const clamp = (n: number) => Math.min(5, Math.max(1, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function adjustDemand(raw: number, e: ScoreEvidence): number {
  const refs = e.painPoints.length + e.signalCount + e.postCount;
  const reviewFrequency = e.painPoints.reduce((s, p) => s + p.frequency, 0);
  let adj = 0;
  if (refs >= 4) adj += 0.5;
  if (reviewFrequency >= 20) adj += 0.5;
  else if (reviewFrequency >= 8) adj += 0.25;
  if (refs < 2) adj -= 0.5;
  return clamp(raw + adj);
}

export function adjustCompetition(raw: number, e: ScoreEvidence): number {
  const known = e.competitors.filter((c) => c.rating !== null);
  if (!known.length) return clamp(raw);
  const strong = known.some((c) => (c.rating ?? 0) >= 4.5 && (c.ratingCount ?? 0) >= 100_000);
  const allWeak = known.every((c) => (c.rating ?? 5) < 3.8);
  const dropping = e.competitors.some((c) => c.ratingDrop);
  let adj = 0;
  if (strong) adj -= 1;
  else if (allWeak || dropping) adj += 0.5;
  return clamp(raw + adj);
}

export function weightedTotal(s: RawScores, w: Weights): number {
  return r2(w.demand * s.demand + w.competition * s.competition + w.monetization * s.monetization + w.effort * s.effort);
}

export function scoreIdea(raw: RawScores, e: ScoreEvidence, w: Weights): FinalScores {
  const s: RawScores = {
    demand: r2(adjustDemand(raw.demand, e)),
    competition: r2(adjustCompetition(raw.competition, e)),
    monetization: r2(clamp(raw.monetization)),
    effort: r2(clamp(raw.effort)),
  };
  return { ...s, total: weightedTotal(s, w) };
}

/** Highest total first; ties → more demand. */
export function rankByScore<T extends { scores: FinalScores }>(ideas: T[], limit: number): T[] {
  return [...ideas].sort((a, b) => b.scores.total - a.scores.total || b.scores.demand - a.scores.demand).slice(0, limit);
}
