import { analyzeTrends, chartKey, signalStrength, type SnapRow } from '../../src/modules/idea-radar/analyzers/trends';
import { pickReviewTargets, type TargetApp } from '../../src/modules/idea-radar/analyzers/targets';

const T = { rank_jump_threshold: 20, growth_threshold_pct: 30, rating_drop_threshold: 0.3, growth_min_rating_count: 50 };

const row = (p: Partial<SnapRow> & { appId: string }): SnapRow => ({
  country: 'us',
  chart: 'top_free',
  category: '',
  rank: null,
  rating: null,
  ratingCount: null,
  ...p,
});

describe('analyzeTrends — two fake periods', () => {
  // Period 1 (previous run) and period 2 (current run).
  const previous: SnapRow[] = [
    row({ appId: 'climber', rank: 60, rating: 4.2, ratingCount: 1000 }),
    row({ appId: 'steady', rank: 5, rating: 4.6, ratingCount: 500_000 }),
    row({ appId: 'grower', chart: 'search', rating: 4.0, ratingCount: 200 }),
    row({ appId: 'dropper', rank: 30, rating: 4.5, ratingCount: 90_000 }),
    row({ appId: 'tiny', chart: 'search', rating: 4.0, ratingCount: 10 }),
    row({ appId: 'gp', chart: 'top_paid', category: 'TOOLS', rank: 45 }),
  ];
  const current: SnapRow[] = [
    row({ appId: 'climber', rank: 12, rating: 4.25, ratingCount: 1100 }), // +48 places
    row({ appId: 'steady', rank: 4, rating: 4.6, ratingCount: 510_000 }), // +1: below threshold
    row({ appId: 'grower', chart: 'search', rating: 4.1, ratingCount: 300 }), // +50% ratings
    row({ appId: 'dropper', rank: 33, rating: 4.1, ratingCount: 91_000 }), // −0.4 rating
    row({ appId: 'tiny', chart: 'search', rating: 4.0, ratingCount: 40 }), // +300% but prev < 50
    row({ appId: 'newbie', rank: 7, rating: 4.8, ratingCount: 800 }), // first time in chart
    row({ appId: 'returning', rank: 50 }), // charted in an older run → not new
    row({ appId: 'gp', chart: 'top_paid', category: 'TOOLS', rank: 10 }), // +35 in a category chart
    row({ appId: 'gp', chart: 'top_paid', category: 'PRODUCTIVITY', rank: 40 }), // also new in another chart
  ];
  const ever = new Set([...previous.filter((r) => r.rank !== null).map(chartKey), chartKey(row({ appId: 'returning' }))]);
  const signals = analyzeTrends(current, previous, ever, T);
  const find = (appId: string, type: string) => signals.find((s) => s.appId === appId && s.signalType === type);

  it('flags a rank jump ≥ threshold with from / to', () => {
    expect(find('climber', 'rank_jump')).toMatchObject({ value: 48, details: { from: 60, to: 12, country: 'us', chart: 'top_free' } });
    expect(find('steady', 'rank_jump')).toBeUndefined();
  });

  it('flags fast rating-count growth only above the minimum base', () => {
    expect(find('grower', 'fast_growth')).toMatchObject({ value: 50, details: { from: 200, to: 300 } });
    expect(find('tiny', 'fast_growth')).toBeUndefined();
  });

  it('flags a rating drop ≥ 0.3', () => {
    expect(find('dropper', 'rating_drop')).toMatchObject({ value: 0.4, details: { from: 4.5, to: 4.1 } });
    expect(find('climber', 'rating_drop')).toBeUndefined();
  });

  it('flags new entries only for never-charted keys', () => {
    expect(find('newbie', 'new_entry')).toMatchObject({ value: 7 });
    expect(find('returning', 'new_entry')).toBeUndefined();
    expect(find('gp', 'new_entry')).toMatchObject({ details: { category: 'PRODUCTIVITY' } });
  });

  it('works on Google Play category charts', () => {
    expect(find('gp', 'rank_jump')).toMatchObject({ value: 35, details: { category: 'TOOLS' } });
  });

  it('emits nothing for unchanged data', () => {
    expect(analyzeTrends(previous, previous, ever, T)).toEqual([]);
  });

  it('emits no new_entry without history (first run)', () => {
    expect(analyzeTrends(current, [], new Set(), T)).toEqual([]);
  });

  it('keeps one signal per app and type — the strongest — and lists the rest', () => {
    const cur = [row({ appId: 'x', rank: 5 }), row({ appId: 'x', country: 'gb', rank: 10 })];
    const prev = [row({ appId: 'x', rank: 50 }), row({ appId: 'x', country: 'gb', rank: 90 })];
    const out = analyzeTrends(cur, prev, new Set(prev.map(chartKey)), T);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ value: 80, details: { country: 'gb', alsoIn: [{ country: 'us', from: 50, to: 5 }] } });
  });

  it('keeps the best rank for multiple new entries', () => {
    const cur = [row({ appId: 'n', rank: 40 }), row({ appId: 'n', country: 'gb', rank: 3 })];
    const out = analyzeTrends(cur, [row({ appId: 'other', rank: 1 })], new Set(), T);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ signalType: 'new_entry', value: 3 });
  });

  it('uses the most informed row per app/country for rating stats', () => {
    const cur = [row({ appId: 'y', chart: 'search', rating: 3.0, ratingCount: null }), row({ appId: 'y', rank: 3, rating: 4.0, ratingCount: 5000 })];
    const prev = [row({ appId: 'y', rank: 3, rating: 4.1, ratingCount: 4900 })];
    expect(analyzeTrends(cur, prev, new Set(prev.map(chartKey)), T)).toEqual([]);
  });

  it('ranks signal strength sensibly', () => {
    expect(signalStrength({ signalType: 'rank_jump', value: 48 })).toBe(48);
    expect(signalStrength({ signalType: 'fast_growth', value: 60 })).toBe(30);
    expect(signalStrength({ signalType: 'rating_drop', value: 0.5 })).toBe(30);
    expect(signalStrength({ signalType: 'new_entry', value: 1 })).toBe(50);
    expect(signalStrength({ signalType: 'new_entry', value: 150 })).toBe(0);
  });
});

describe('pickReviewTargets', () => {
  const app = (id: string, store: TargetApp['store'], p: Partial<TargetApp> = {}): TargetApp => ({
    id,
    store,
    storeAppId: id,
    title: id,
    bestRank: Infinity,
    inSearch: false,
    ratingCount: 0,
    ...p,
  });

  it('puts signal apps first (rating_drop before rank_jump), then search, then chart rank', () => {
    const apps = [
      app('chart1', 'app_store', { bestRank: 1 }),
      app('search-small', 'app_store', { inSearch: true, ratingCount: 10 }),
      app('search-big', 'app_store', { inSearch: true, ratingCount: 9000 }),
      app('jumper', 'app_store', { bestRank: 30 }),
      app('dropper', 'app_store', { bestRank: 50 }),
    ];
    const out = pickReviewTargets(apps, [{ appId: 'jumper', signalType: 'rank_jump' }, { appId: 'dropper', signalType: 'rating_drop' }], 10);
    expect(out.map((a) => a.id)).toEqual(['dropper', 'jumper', 'search-big', 'search-small', 'chart1']);
  });

  it('splits the cap across stores and hands unused share to the other store', () => {
    const apps = [
      ...Array.from({ length: 10 }, (_, i) => app(`gp${i}`, 'google_play', { bestRank: i + 1 })),
      app('ios0', 'app_store', { bestRank: 1 }),
    ];
    const out = pickReviewTargets(apps, [], 6);
    expect(out).toHaveLength(6);
    expect(out.filter((a) => a.store === 'app_store')).toHaveLength(1);
    expect(pickReviewTargets(apps, [], 0)).toEqual([]);
  });
});
