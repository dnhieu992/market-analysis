/**
 * SHORT score of the /trades OKX chat: the user's own checklist (each criterion = points), scored
 * as hitPoints / totalPoints. Criteria are small JS snippets so the chat can add / change them
 * without a deploy; they run in the backtest Docker sandbox (BacktestLabService.evaluate), never in
 * the API process. The same code is used for today's score and for the historical backtest.
 */
import { INTERVAL_MS } from '../backtest-lab/kline-loader';

export const SCORE_SET_SKILL_ID = 'okx-short-score';

export type ScoreCriterion = {
  /** slug, unique in the set */
  id: string;
  label: string;
  points: number;
  enabled?: boolean;
  /** Body of `function (d, ta, ext, lib)` → boolean | { hit, detail } */
  code: string;
};

export type ScoreSet = {
  symbol: string;
  /** Kline intervals handed to the criteria as d['1d'], d['4h']… (max 4; the smallest is used for prices). */
  intervals: string[];
  criteria: ScoreCriterion[];
};

export type CriterionResult = { id: string; hit: boolean; detail: string | null; error?: string };

export const DEFAULT_SCORE_SET: ScoreSet = {
  symbol: 'BTCUSDT',
  intervals: ['1d', '4h', '1h', '15m'],
  criteria: [
    {
      id: 'd1_trend_down',
      label: 'D1 xu hướng giảm (close < EMA50 và EMA20 < EMA50)',
      points: 1,
      code: "return lib.trendDown(d['1d'], 20, 50);",
    },
    {
      id: 'h4_trend_down',
      label: 'H4 xu hướng giảm (close < EMA50 và EMA20 < EMA50)',
      points: 1,
      code: "return lib.trendDown(d['4h'], 20, 50);",
    },
    {
      id: 'fear_greed',
      label: 'Fear & Greed trong (30, 50) hoặc > 70',
      points: 1,
      code: [
        "const v = ext.fngNow;",
        "if (v == null) return { hit: false, detail: 'không có dữ liệu F&G' };",
        "return { hit: (v > 30 && v < 50) || v > 70, detail: 'F&G = ' + v };",
      ].join('\n'),
    },
    {
      id: 'rsi_h4',
      label: 'RSI(14) H4 trong (40, 50) hoặc > 80',
      points: 1,
      code: [
        "const r = lib.rsiLast(d['4h'], 14);",
        "return { hit: (r > 40 && r < 50) || r > 80, detail: 'RSI H4 = ' + r.toFixed(1) };",
      ].join('\n'),
    },
    {
      id: 'sonic_h4_stack_down',
      label: 'Sonic R H4: EMA34 < EMA89 < EMA200 (3 EMA xếp giảm)',
      points: 1,
      code: "return lib.emaStackDown(d['4h'], [34, 89, 200]);",
    },
    {
      id: 'morning_pump',
      label: 'Buổi sáng (07:00–12:00 giờ VN) giá tăng ≥ 1.2% so với giá mở 07:00',
      points: 1,
      code: [
        "const m = lib.morningMove(d['15m'], ext.now, 7, 12);",
        "if (!m) return { hit: false, detail: 'chưa có dữ liệu buổi sáng' };",
        "return { hit: m.maxUpPct >= 1.2, detail: 'sáng ' + m.date + ': cao nhất +' + m.maxUpPct.toFixed(2) + '%, hiện ' + m.closeChgPct.toFixed(2) + '%' + (m.complete ? '' : ' (chưa hết buổi sáng)') };",
      ].join('\n'),
    },
    {
      id: 'h4_fib_retest',
      label: 'H4 vừa giảm mạnh (≥ 5% trong 10 ngày) và hồi lên test lại Fibo 0.5',
      points: 1,
      code: "return lib.fibRetest(d['4h'], { lookback: 60, minDropPct: 5, level: 0.5, tolPct: 0.5, maxLevel: 0.618, recentBars: 6 });",
    },
    {
      id: 'd1_fib_retest',
      label: 'D1 giảm mạnh (≥ 12% trong 60 ngày) và hồi lên test lại Fibo 0.5',
      points: 1,
      code: "return lib.fibRetest(d['1d'], { lookback: 60, minDropPct: 12, level: 0.5, tolPct: 1, maxLevel: 0.618, recentBars: 3 });",
    },
  ],
};

/** Helpers available to every criterion as `lib` (plain JS, runs inside the sandbox). */
export const SCORE_LIB_SOURCE = String.raw`
const lib = (() => {
  const H = 3600000;
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const last = (a) => a[a.length - 1];
  const fmt = (x) => (fin(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toPrecision(5)) : String(x));
  const need = (c, n, what) => { if (!c || c.length < n) throw new Error((what || 'dữ liệu') + ': cần ít nhất ' + n + ' nến, có ' + (c ? c.length : 0)); };
  const lastEma = (c, n) => { need(c, n, 'EMA' + n); return last(ta.ema(c, n)); };
  return {
    last, fmt, lastEma,
    rsiLast(c, n) { need(c, (n || 14) + 1, 'RSI'); return last(ta.rsi(c, n || 14)); },
    /** close < EMA(slow) và EMA(fast) < EMA(slow) trên nến đã đóng gần nhất */
    trendDown(c, fast, slow) {
      fast = fast || 20; slow = slow || 50;
      const ef = lastEma(c, fast), es = lastEma(c, slow), cl = last(c).close;
      return { hit: cl < es && ef < es, detail: 'close ' + fmt(cl) + ' · EMA' + fast + ' ' + fmt(ef) + ' · EMA' + slow + ' ' + fmt(es) };
    },
    trendUp(c, fast, slow) {
      fast = fast || 20; slow = slow || 50;
      const ef = lastEma(c, fast), es = lastEma(c, slow), cl = last(c).close;
      return { hit: cl > es && ef > es, detail: 'close ' + fmt(cl) + ' · EMA' + fast + ' ' + fmt(ef) + ' · EMA' + slow + ' ' + fmt(es) };
    },
    /** EMA ngắn < EMA trung < EMA dài (xếp giảm) */
    emaStackDown(c, periods) {
      const v = periods.map((p) => lastEma(c, p));
      let hit = true;
      for (let i = 1; i < v.length; i++) if (!(v[i - 1] < v[i])) hit = false;
      return { hit, detail: periods.map((p, i) => 'EMA' + p + ' ' + fmt(v[i])).join(' · ') };
    },
    /** Window [startHourVn, endHourVn) giờ VN gần nhất đã bắt đầu, tính trên khung nhỏ (vd 15m). */
    morningMove(c, now, startHourVn, endHourVn) {
      const startUtc = ((startHourVn - 7) % 24 + 24) % 24;
      let s = Math.floor(now / (24 * H)) * 24 * H + startUtc * H;
      if (s > now) s -= 24 * H;
      const e = s + (endHourVn - startHourVn) * H;
      const bars = c.filter((b) => b.time >= s && b.time < e && b.closeTime < now);
      if (!bars.length) return null;
      const open = bars[0].open;
      let hi = -Infinity, lo = Infinity;
      for (const b of bars) { if (b.high > hi) hi = b.high; if (b.low < lo) lo = b.low; }
      const d = new Date(s + 7 * H);
      return {
        date: d.toISOString().slice(0, 10),
        open, high: hi, low: lo,
        maxUpPct: (hi / open - 1) * 100,
        maxDownPct: (lo / open - 1) * 100,
        closeChgPct: (last(bars).close / open - 1) * 100,
        complete: now >= e,
      };
    },
    /**
     * Nhịp giảm mạnh rồi hồi test Fibo: đỉnh cao nhất trong 'lookback' nến → đáy thấp nhất sau đỉnh,
     * giảm ≥ minDropPct; trong 'recentBars' nến gần nhất (sau đáy) giá chạm mức level (± tolPct)
     * và nến đóng gần nhất vẫn dưới mức maxLevel (chưa phá).
     */
    fibRetest(c, o) {
      o = Object.assign({ lookback: 60, minDropPct: 5, level: 0.5, tolPct: 0.5, maxLevel: 0.618, recentBars: 6 }, o || {});
      need(c, 10, 'fibRetest');
      const w = c.slice(Math.max(0, c.length - o.lookback));
      let ih = 0;
      for (let i = 1; i < w.length; i++) if (w[i].high > w[ih].high) ih = i;
      let il = ih;
      for (let i = ih + 1; i < w.length; i++) if (w[i].low < w[il].low) il = i;
      if (il === ih) return { hit: false, detail: 'không có nhịp giảm sau đỉnh ' + fmt(w[ih].high) };
      const Hh = w[ih].high, Ll = w[il].low, drop = ((Hh - Ll) / Hh) * 100;
      const fib = Ll + o.level * (Hh - Ll), inval = Ll + o.maxLevel * (Hh - Ll);
      const base = 'đỉnh ' + fmt(Hh) + ' → đáy ' + fmt(Ll) + ' (−' + drop.toFixed(1) + '%), fib ' + o.level + ' = ' + fmt(fib);
      if (drop < o.minDropPct) return { hit: false, detail: base + ' · giảm chưa đủ ' + o.minDropPct + '%' };
      const recent = w.slice(Math.max(il + 1, w.length - o.recentBars));
      if (!recent.length) return { hit: false, detail: base + ' · chưa hồi' };
      let rh = -Infinity;
      for (const b of recent) if (b.high > rh) rh = b.high;
      const touched = rh >= fib * (1 - o.tolPct / 100);
      const holding = last(w).close < inval;
      return {
        hit: touched && holding,
        detail: base + ' · cao nhất gần đây ' + fmt(rh) + (touched ? ' (đã chạm)' : ' (chưa chạm)') + (holding ? '' : ' · đã đóng trên fib ' + o.maxLevel),
      };
    },
  };
})();
`;

const ID_RE = /^[a-z0-9][a-z0-9_]{1,40}$/;

/** Validates / normalises a criteria set coming from the chat or the DB. Throws a readable error. */
export function parseScoreSet(raw: unknown): ScoreSet {
  const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!o || typeof o !== 'object') throw new Error('Bộ tiêu chí phải là object { symbol, intervals, criteria }.');
  const r = o as Record<string, unknown>;
  const symbol = String(r.symbol ?? 'BTCUSDT').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
  const intervals = Array.isArray(r.intervals) && r.intervals.length ? r.intervals.map((x) => String(x).trim()) : DEFAULT_SCORE_SET.intervals;
  if (intervals.length > 4) throw new Error('Tối đa 4 khung thời gian (intervals).');
  const bad = intervals.find((i) => !INTERVAL_MS[i]);
  if (bad) throw new Error(`Khung không hỗ trợ: ${bad} (dùng ${Object.keys(INTERVAL_MS).join(', ')}).`);
  if (!Array.isArray(r.criteria) || !r.criteria.length) throw new Error('Cần ít nhất 1 tiêu chí (criteria).');
  if (r.criteria.length > 30) throw new Error('Tối đa 30 tiêu chí.');
  const seen = new Set<string>();
  const criteria = r.criteria.map((c, i): ScoreCriterion => {
    const x = (c ?? {}) as Record<string, unknown>;
    const id = String(x.id ?? '').trim();
    if (!ID_RE.test(id)) throw new Error(`Tiêu chí #${i + 1}: id phải là slug a-z0-9_ (2–41 ký tự).`);
    if (seen.has(id)) throw new Error(`Trùng id tiêu chí: ${id}`);
    seen.add(id);
    const label = String(x.label ?? '').trim();
    if (!label) throw new Error(`Tiêu chí ${id}: thiếu label.`);
    const points = x.points == null ? 1 : Number(x.points);
    if (!(points > 0 && points <= 10)) throw new Error(`Tiêu chí ${id}: points phải trong (0, 10].`);
    const code = String(x.code ?? '').trim();
    if (code.length < 5 || code.length > 4000) throw new Error(`Tiêu chí ${id}: code rỗng hoặc quá dài (> 4000 ký tự).`);
    return { id, label: label.slice(0, 200), points, enabled: x.enabled === false ? false : true, code };
  });
  if (!criteria.some((c) => c.enabled !== false)) throw new Error('Phải bật ít nhất 1 tiêu chí.');
  return { symbol, intervals: [...new Set(intervals)], criteria };
}

/**
 * Sandbox program: evaluates every enabled criterion at each time in ctx.params.at (ms). In
 * 'history' mode it also records, from the price at that time, which of ±moves% was touched first
 * (1 = short won, -1 = long won, null = both in one bar / not within 30 days).
 */
export function buildScoreCode(set: ScoreSet): string {
  const crits = set.criteria
    .filter((c) => c.enabled !== false)
    .map((c) => `  { id: ${JSON.stringify(c.id)}, fn: function (d, ta, ext, lib) {\n${c.code}\n} },`)
    .join('\n');
  return String.raw`
const P = ctx.params;
const SYM = ctx.symbols[0];
const ALL = ctx.data[SYM];
const IVS = ctx.intervals;
const FINE = P.fine;
${SCORE_LIB_SOURCE}
const CRIT = [
${crits}
];
const FNG = P.fng || [];
function closedBefore(c, t) { let lo = 0, hi = c.length; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m].closeTime < t) lo = m + 1; else hi = m; } return lo; }
function view(t) {
  const d = {};
  for (const iv of IVS) { const c = ALL[iv]; const k = closedBefore(c, t); d[iv] = c.slice(Math.max(0, k - P.maxBars), k); }
  return d;
}
function ext(t, d) {
  let lo = 0, hi = FNG.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (FNG[m].time <= t) lo = m + 1; else hi = m; }
  const f = d[FINE];
  return Object.freeze({ now: t, symbol: SYM, fng: FNG.slice(Math.max(0, lo - 60), lo), fngNow: lo > 0 ? FNG[lo - 1].value : null, price: f.length ? f[f.length - 1].close : null });
}
function evalAt(t) {
  const d = view(t);
  const e = ext(t, d);
  const res = CRIT.map((c) => {
    try {
      const r = c.fn(d, ta, e, lib);
      const o = r && typeof r === 'object' ? r : { hit: !!r };
      return { id: c.id, hit: !!o.hit, detail: o.detail == null ? null : String(o.detail).slice(0, 300) };
    } catch (err) {
      return { id: c.id, hit: false, detail: null, error: String((err && err.message) || err).slice(0, 300) };
    }
  });
  return { price: e.price, results: res };
}
function firstTouch(t, price, pct) {
  const c = ALL[FINE];
  let i = closedBefore(c, t + 1);
  while (i < c.length && c[i].time < t) i++;
  const up = price * (1 + pct / 100), dn = price * (1 - pct / 100), end = t + 30 * 86400000;
  for (; i < c.length && c[i].time < end; i++) {
    const u = c[i].high >= up, w = c[i].low <= dn;
    if (u && w) return null;
    if (w) return 1;
    if (u) return -1;
  }
  return null;
}
if (P.mode === 'now') {
  const t = P.at[0];
  const r = evalAt(t);
  return { trades: [], summary: { t, price: r.price, results: r.results } };
}
const rows = [];
const errors = {};
for (const t of P.at) {
  const r = evalAt(t);
  if (r.price == null) continue;
  for (const x of r.results) if (x.error && !errors[x.id]) errors[x.id] = new Date(t).toISOString().slice(0, 16) + ': ' + x.error;
  rows.push({ t, price: r.price, hits: r.results.map((x) => (x.error ? -1 : x.hit ? 1 : 0)), out: P.moves.map((m) => firstTouch(t, r.price, m)) });
}
return { trades: [], summary: { ids: CRIT.map((c) => c.id), rows, errors } };
`;
}
