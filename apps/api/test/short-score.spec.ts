import { DEFAULT_SCORE_SET, SCORE_LIB_SOURCE, buildScoreCode, parseScoreSet } from '../src/modules/short-score/short-score.engine';

const H = 3_600_000;
type C = { time: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };
const bar = (time: number, ms: number, o: number, h: number, l: number, c: number): C => ({ time, closeTime: time + ms - 1, open: o, high: h, low: l, close: c, volume: 1 });

// `lib` only needs ta.ema / ta.rsi from the sandbox; a tiny EMA is enough for these checks.
const fakeTa = {
  ema: (c: C[], n: number) => {
    const v = c.map((x) => x.close);
    const out: number[] = [];
    const k = 2 / (n + 1);
    let e = v[0]!;
    v.forEach((x, i) => {
      e = i === 0 ? x : x * k + e * (1 - k);
      out.push(e);
    });
    return out;
  },
  rsi: (c: C[]) => c.map(() => 45),
};
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const lib = new Function('ta', `${SCORE_LIB_SOURCE}\nreturn lib;`)(fakeTa);

describe('short score engine', () => {
  it('accepts the default set and rejects broken sets with a readable reason', () => {
    expect(parseScoreSet(DEFAULT_SCORE_SET).criteria).toHaveLength(8);
    expect(() => parseScoreSet({ criteria: [] })).toThrow('ít nhất 1 tiêu chí');
    expect(() => parseScoreSet({ criteria: [{ id: 'Bad Id', label: 'x', code: 'return true;' }] })).toThrow('slug');
    expect(() => parseScoreSet({ intervals: ['7m'], criteria: [{ id: 'a1', label: 'x', code: 'return true;' }] })).toThrow('Khung không hỗ trợ');
    const dup = { id: 'a1', label: 'x', code: 'return true;' };
    expect(() => parseScoreSet({ criteria: [dup, dup] })).toThrow('Trùng id');
    expect(parseScoreSet(JSON.stringify({ criteria: [{ id: 'a1', label: 'x', code: 'return true;' }] })).criteria[0]!.points).toBe(1);
  });

  it('builds one function per enabled criterion', () => {
    const set = parseScoreSet({ criteria: [{ id: 'on_one', label: 'x', code: 'return true;' }, { id: 'off_one', label: 'y', enabled: false, code: 'return true;' }] });
    const code = buildScoreCode(set);
    expect(code).toContain('"on_one"');
    expect(code).not.toContain('"off_one"');
  });

  it('measures the Vietnam morning move (07:00–12:00 VN = 00:00–05:00 UTC) on closed bars only', () => {
    const day = Date.UTC(2026, 10, 7);
    const ms = 15 * 60_000;
    const c: C[] = [];
    for (let i = -8; i < 24; i++) {
      const t = day + i * ms;
      // before 00:00 UTC flat at 99; from 00:00 UTC open 100, ramps to a 101.5 high
      const o = t < day ? 99 : 100;
      c.push(bar(t, ms, o, t < day ? 99 : 100 + Math.min(1.5, (i + 1) * 0.1), t < day ? 99 : 99.9, t < day ? 99 : 100.5));
    }
    const now = day + 6 * H; // 13:00 VN, morning complete
    const m = lib.morningMove(c, now, 7, 12);
    expect(m.date).toBe('2026-11-07');
    expect(m.open).toBe(100);
    expect(m.maxUpPct).toBeCloseTo(1.5, 6);
    expect(m.complete).toBe(true);
    // at 08:00 VN only the first 4 bars are closed
    const early = lib.morningMove(c, day + H, 7, 12);
    expect(early.complete).toBe(false);
    expect(early.maxUpPct).toBeCloseTo(0.4, 6);
  });

  it('flags a fib 0.5 retest after a strong drop, and not before the bounce reaches it', () => {
    const ms = 4 * H;
    const mk = (closes: Array<[number, number, number]>) => closes.map(([h, l, cl], i) => bar(i * ms, ms, cl, h, l, cl));
    // high 110 → low 90 (−18%), fib 0.5 = 100
    const flat: Array<[number, number, number]> = Array.from({ length: 6 }, () => [105, 103, 104] as [number, number, number]);
    const drop: Array<[number, number, number]> = [...flat, [110, 108, 109], [108, 100, 101], [101, 92, 93], [93, 90, 91], [94, 90, 93]];
    const notYet = lib.fibRetest(mk([...drop, [97, 93, 96]]), { lookback: 60, minDropPct: 5, recentBars: 6, tolPct: 0.5 });
    expect(notYet.hit).toBe(false);
    const touched = lib.fibRetest(mk([...drop, [97, 93, 96], [100.2, 96, 98]]), { lookback: 60, minDropPct: 5, recentBars: 6, tolPct: 0.5 });
    expect(touched.hit).toBe(true);
    // closed above 0.618 (102.36) → retest failed
    const broken = lib.fibRetest(mk([...drop, [97, 93, 96], [104, 96, 103]]), { lookback: 60, minDropPct: 5, recentBars: 6, tolPct: 0.5 });
    expect(broken.hit).toBe(false);
    expect(lib.fibRetest(mk(drop.concat([[97, 93, 96]])), { minDropPct: 25 }).detail).toContain('giảm chưa đủ');
  });

  it('trendDown / emaStackDown read the last closed bar', () => {
    const ms = 4 * H;
    const down = Array.from({ length: 300 }, (_, i) => bar(i * ms, ms, 200 - i * 0.5, 201 - i * 0.5, 199 - i * 0.5, 200 - i * 0.5));
    expect(lib.trendDown(down, 20, 50).hit).toBe(true);
    expect(lib.emaStackDown(down, [34, 89, 200]).hit).toBe(true);
    expect(() => lib.emaStackDown(down.slice(0, 50), [34, 89, 200])).toThrow('cần ít nhất');
  });
});
