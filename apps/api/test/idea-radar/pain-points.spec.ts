import {
  analyzePostNeeds,
  analyzeReviewPainPoints,
  chunk,
  heuristicPainPoints,
  heuristicPostNeeds,
  normalizePostNeeds,
  normalizeReviewPain,
  painWeight,
  renderPosts,
  renderReviewBatch,
  type AppReviews,
  type PostInput,
} from '../../src/modules/idea-radar/analyzers/pain-points';
import { BudgetExceededError, RadarLlm, type LlmUsageSink, type StructuredAsker } from '../../src/modules/idea-radar/llm';

const reviews = (n: number, body: string) => Array.from({ length: n }, (_, i) => ({ rating: 1, title: i === 0 ? 'Awful' : null, body: `${body} #${i}` }));

const apps: AppReviews[] = [
  { appId: 'a1', title: 'Scanner Pro', store: 'app_store', reviews: [...reviews(4, 'Too many ads after every scan'), ...reviews(2, 'Crashes on open')] },
  { appId: 'a2', title: 'Habit X', store: 'google_play', reviews: reviews(5, 'Subscription paywall for basic streaks') },
  { appId: 'a3', title: 'Quiet', store: 'google_play', reviews: reviews(1, 'meh') },
];

const posts: PostInput[] = [
  { id: 'p1', source: 'reddit', title: 'Is there an app for splitting receipts?', body: 'I would pay', extra: { subreddit: 'AppIdeas', demandMatch: ['is there an app'] } },
  { id: 'p2', source: 'hn', title: 'Show HN: my budget app', body: null, extra: null },
];

const usage = (): LlmUsageSink & { rows: unknown[] } => {
  const rows: unknown[] = [];
  return { rows, monthCostUsd: async () => 0, recordUsage: async (u) => void rows.push(u) };
};

const asker = (outputs: unknown[]): StructuredAsker & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    prompts,
    askStructured: async (_s, prompt) => {
      prompts.push(prompt);
      const out = outputs.shift();
      return { structuredOutput: out ?? null, text: '', costUsd: 0.01, inputTokens: 100, outputTokens: 50, model: 'm' };
    },
  };
};

describe('pain points — prompt rendering', () => {
  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('renders batches with A-refs and caps reviews', () => {
    const text = renderReviewBatch(apps.slice(0, 2), 3);
    expect(text).toContain('## ref: A1 · Scanner Pro (app_store, 3 reviews)');
    expect(text).toContain('## ref: A2 · Habit X');
    expect(text).toContain('★1 Awful — Too many ads after every scan #0');
    expect(text.match(/^- ★/gm)).toHaveLength(6);
  });

  it('renders posts with S-refs', () => {
    expect(renderPosts(posts)).toBe('- S1 [r/AppIdeas] Is there an app for splitting receipts? — I would pay\n- S2 [HN] Show HN: my budget app');
  });
});

describe('pain points — normalizing LLM output', () => {
  it('maps refs back to apps, caps frequency at review count and filters by min frequency', () => {
    const out = normalizeReviewPain(
      {
        apps: [
          {
            ref: 'A1',
            pain_points: [
              { summary: 'Quá nhiều quảng cáo', category: 'ads_too_many', frequency: 40, severity: 4, quotes: ['a', 'b', 'c', 'd'] },
              { summary: 'Crash', category: 'bugs_crash', frequency: 2, severity: 5, quotes: [] },
            ],
          },
          { ref: 'A9', pain_points: [{ summary: 'ghost', category: 'other', frequency: 9, severity: 1, quotes: [] }] },
        ],
      },
      apps,
      3,
      120,
    );
    expect(out).toEqual([
      { source: 'review', appId: 'a1', postIds: null, summary: 'Quá nhiều quảng cáo', category: 'ads_too_many', frequency: 6, severity: 4, quotes: ['a', 'b', 'c'] },
    ]);
  });

  it('maps post refs to ids and drops needs without valid refs', () => {
    const out = normalizePostNeeds(
      {
        needs: [
          { summary: 'Tách hoá đơn', category: 'missing_feature', post_refs: ['S1', 'S1', 'S7'], frequency: 3, severity: 4, quotes: ['x'] },
          { summary: 'none', category: 'other', post_refs: ['S9'], frequency: 1, severity: 1, quotes: [] },
        ],
      },
      posts,
    );
    expect(out).toEqual([{ source: 'post', appId: null, postIds: ['p1'], summary: 'Tách hoá đơn', category: 'missing_feature', frequency: 1, severity: 4, quotes: ['x'] }]);
  });

  it('weights by frequency × severity', () => {
    expect(painWeight({ frequency: 6, severity: 4 })).toBe(24);
  });
});

describe('pain points — dry-run heuristic', () => {
  it('finds categories by keywords with ≥ min frequency', () => {
    const out = heuristicPainPoints(apps, 3);
    expect(out.map((p) => [p.appId, p.category, p.frequency])).toEqual([
      ['a1', 'ads_too_many', 4],
      ['a2', 'paywall', 5],
    ]);
    expect(out[0]?.summary).toMatch(/^\[dry-run\]/);
  });

  it('turns demand-keyword posts into needs', () => {
    expect(heuristicPostNeeds(posts)).toHaveLength(1);
  });

  it('runs both analyzers without an LLM', async () => {
    const pains = await analyzeReviewPainPoints(null, apps, { minFrequency: 3, appsPerBatch: 2, maxReviewsInPrompt: 50, model: 'm', concurrency: 1 }, () => undefined);
    expect(pains).toHaveLength(2);
    expect(await analyzePostNeeds(null, posts, 'm')).toHaveLength(1);
    expect(await analyzePostNeeds(null, [], 'm')).toEqual([]);
  });
});

describe('pain points — with the LLM', () => {
  const opts = { minFrequency: 3, appsPerBatch: 1, maxReviewsInPrompt: 50, model: 'cheap', concurrency: 2 };

  it('batches apps (skipping those with too few reviews) and records usage', async () => {
    const ask = asker([
      { apps: [{ ref: 'A1', pain_points: [{ summary: 'Ads', category: 'ads_too_many', frequency: 4, severity: 3, quotes: [] }] }] },
      { apps: [{ ref: 'A1', pain_points: [{ summary: 'Paywall', category: 'paywall', frequency: 5, severity: 4, quotes: [] }] }] },
    ]);
    const u = usage();
    const out = await analyzeReviewPainPoints(new RadarLlm(ask, u, 10), apps, opts, () => undefined);
    expect(ask.prompts).toHaveLength(2); // a3 has 1 review < min frequency
    expect(out.map((p) => p.appId).sort()).toEqual(['a1', 'a2']);
    expect(u.rows).toHaveLength(2);
  });

  it('records a failed batch and carries on', async () => {
    const ask = asker([{ wrong: true }, { wrong: true }, { apps: [] }]);
    const errors: string[] = [];
    const out = await analyzeReviewPainPoints(new RadarLlm(ask, usage(), 10), apps, { ...opts, concurrency: 1 }, (m) => errors.push(m));
    expect(out).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/batch 1\/2/);
  });

  it('stops on budget exhaustion', async () => {
    const llm = new RadarLlm(asker([]), { monthCostUsd: async () => 25, recordUsage: async () => undefined }, 20);
    await expect(analyzeReviewPainPoints(llm, apps, opts, () => undefined)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('extracts post needs', async () => {
    const ask = asker([{ needs: [{ summary: 'Tách hoá đơn', category: 'missing_feature', post_refs: ['S1'], frequency: 1, severity: 4, quotes: [] }] }]);
    const out = await analyzePostNeeds(new RadarLlm(ask, usage(), 10), posts, 'cheap');
    expect(out[0]?.postIds).toEqual(['p1']);
  });
});
