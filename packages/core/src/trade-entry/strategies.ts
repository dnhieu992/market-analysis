import type { EntryFeatures } from './features';

/**
 * Entry strategies the trader can declare on a trade, with the code that checks
 * whether a given market snapshot matches them. Several strategies run side by
 * side; each is versioned (`key` + `version`) so a rule change starts a new
 * version and old trades stay attributed to the rule they were taken under.
 * Keep the catalogue rows in `trade_strategies` (migration seed) in sync.
 */

export type EntryMode = 'SWING' | 'SCALP' | 'HEDGE' | 'OTHER';

export type EntryCheck = { label: string; pass: boolean | null; value: string };

export type EntryStrategyContext = {
  symbol: string;
  side: 'long' | 'short';
  /** An open position on the opposite side of the same coin + exchange. */
  opposite?: { size: number; roePct?: number | null } | null;
  /** Size of this entry (for the hedge ½ rule). */
  size?: number | null;
};

export type EntryStrategyResult = {
  key: string;
  version: number;
  name: string;
  mode: EntryMode;
  /** Best grade matched (e.g. "A", "B", "strong", "normal", "hedge"), null = not matched. */
  grade: string | null;
  checks: EntryCheck[];
};

export type EntryStrategyDef = {
  key: string;
  version: number;
  name: string;
  mode: EntryMode;
  /** Short Vietnamese description shown in pickers and AI tools. */
  summary: string;
  /** false = can only be declared (e.g. discretionary), never auto-matched. */
  matchable: boolean;
  evaluate?: (f: EntryFeatures | null, ctx: EntryStrategyContext) => { grade: string | null; checks: EntryCheck[] };
};

const MAJORS = new Set(['BTCUSDT', 'ETHUSDT']);
const fmt = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));
const lt = (v: number | null | undefined, max: number) => (v == null ? null : v < max);
const lte = (v: number | null | undefined, max: number) => (v == null ? null : v <= max);
const isLong = (v: string | null | undefined) => (v == null ? null : v === 'long');
const allPass = (checks: EntryCheck[]) => checks.every((c) => c.pass === true);

export const ENTRY_STRATEGIES: EntryStrategyDef[] = [
  {
    key: 'qqe-pullback-swing',
    version: 1,
    name: 'QQE D1 + nhịp hồi RSI H4 (SWING)',
    mode: 'SWING',
    matchable: true,
    summary:
      'Long: QQE D1 long + RSI H4 < 40 + giá ≤ EMA89 D1 +15% (hạng A, ký quỹ Setup); nới RSI H4 < 45 + ≤ EMA89 +25% (hạng B, ½ ký quỹ). TP alt ≥ +5%, DCA 3×5%.',
    evaluate: (f, ctx) => {
      const side = { label: 'Chiều LONG', pass: ctx.side === 'long', value: ctx.side };
      const q = { label: 'QQE D1 long', pass: isLong(f?.qqeD1), value: f?.qqeD1 ?? '—' };
      const a = [
        side,
        q,
        { label: 'RSI H4 < 40', pass: lt(f?.rsiH4, 40), value: fmt(f?.rsiH4) },
        { label: 'Giá ≤ EMA89 D1 +15%', pass: lte(f?.distEma89D1Pct, 15), value: `${fmt(f?.distEma89D1Pct)}%` },
      ];
      if (allPass(a)) return { grade: 'A', checks: a };
      const b = [
        side,
        q,
        { label: 'RSI H4 < 45 (hạng B)', pass: lt(f?.rsiH4, 45), value: fmt(f?.rsiH4) },
        { label: 'Giá ≤ EMA89 D1 +25% (hạng B)', pass: lte(f?.distEma89D1Pct, 25), value: `${fmt(f?.distEma89D1Pct)}%` },
      ];
      if (allPass(b)) return { grade: 'B', checks: b };
      return { grade: null, checks: a };
    },
  },
  {
    key: 'qqe-rsi1h-scalp',
    version: 1,
    name: 'QQE D1 + quá bán RSI 1h (SCALP)',
    mode: 'SCALP',
    matchable: true,
    summary: 'Long: QQE D1 long + RSI 1h < 35; "mạnh" khi thêm QQE H4 long + RSI 1h < 30. TP alt ≥ +2%, DCA 3×5%.',
    evaluate: (f, ctx) => {
      const base = [
        { label: 'Chiều LONG', pass: ctx.side === 'long', value: ctx.side },
        { label: 'QQE D1 long', pass: isLong(f?.qqeD1), value: f?.qqeD1 ?? '—' },
        { label: 'RSI 1h < 35', pass: lt(f?.rsi1h, 35), value: fmt(f?.rsi1h) },
      ];
      if (!allPass(base)) return { grade: null, checks: base };
      const strong = [
        ...base,
        { label: 'QQE H4 long (mạnh)', pass: isLong(f?.qqeH4), value: f?.qqeH4 ?? '—' },
        { label: 'RSI 1h < 30 (mạnh)', pass: lt(f?.rsi1h, 30), value: fmt(f?.rsi1h) },
      ];
      return allPass(strong) ? { grade: 'strong', checks: strong } : { grade: 'normal', checks: base };
    },
  },
  {
    key: 'pa-sweep-reclaim',
    version: 1,
    name: 'PA: quét đáy H4 & lấy lại + D1 tăng (SWING)',
    mode: 'SWING',
    matchable: true,
    summary:
      'Price action thuần, không indicator: D1 cấu trúc tăng (2 đỉnh / 2 đáy D1 gần nhất đều cao dần) + nến H4 quét thủng đáy swing gần nhất rồi đóng lại trên đáy đó (lần quét đầu tiên), vào ở 1–2 nến H4 sau tín hiệu khi giá còn trên đáy bị quét. TP alt ≥ +5%, DCA 3×5%.',
    evaluate: (f, ctx) => {
      const sw = f?.paSweepH4 ?? null;
      const v2 = f?.d1Structure !== undefined;
      const checks: EntryCheck[] = [
        { label: 'Chiều LONG', pass: ctx.side === 'long', value: ctx.side },
        {
          label: 'D1 cấu trúc tăng (HH+HL)',
          pass: !v2 ? null : f?.d1Structure == null ? null : f.d1Structure === 'up',
          value: f?.d1Structure ?? '—',
        },
        {
          label: 'Nến H4 quét đáy & đóng lại trên (≤ 2 nến trước)',
          pass: !v2 ? null : sw != null,
          value: sw ? `quét ${sw.sweptLow} (râu ${sw.low}), ${sw.barsAgo === 0 ? 'nến vừa đóng' : `${sw.barsAgo} nến trước`}` : v2 ? 'không' : '—',
        },
        {
          label: 'Giá vào còn trên đáy bị quét',
          pass: sw == null || f == null ? null : f.price > sw.sweptLow,
          value: sw && f ? `${fmt(((f.price / sw.sweptLow) - 1) * 100, 2)}%` : '—',
        },
      ];
      return { grade: allPass(checks) ? 'A' : null, checks };
    },
  },
  {
    key: 'hedge-short',
    version: 1,
    name: 'Short alt phòng hộ cho long đang gồng',
    mode: 'HEDGE',
    matchable: true,
    summary: 'Short alt CHỈ khi đang có long gồng lỗ cùng coin cùng sàn, size ≤ ½ long, TP +0.6–1%, đóng theo long. Không áp cho BTC/ETH.',
    evaluate: (_f, ctx) => {
      const ratio = ctx.opposite && ctx.size != null && ctx.opposite.size > 0 ? ctx.size / ctx.opposite.size : null;
      const checks: EntryCheck[] = [
        { label: 'Chiều SHORT', pass: ctx.side === 'short', value: ctx.side },
        { label: 'Altcoin (không phải BTC/ETH)', pass: !MAJORS.has(ctx.symbol), value: ctx.symbol },
        { label: 'Có long cùng coin cùng sàn', pass: ctx.opposite ? true : false, value: ctx.opposite ? `size ${ctx.opposite.size}` : 'không' },
        {
          label: 'Long đang lỗ',
          pass: ctx.opposite?.roePct == null ? null : ctx.opposite.roePct < 0,
          value: ctx.opposite?.roePct != null ? `ROE ${fmt(ctx.opposite.roePct)}%` : '—',
        },
        { label: 'Size ≤ ½ long', pass: ratio == null ? null : ratio <= 0.5 + 1e-9, value: ratio != null ? `${fmt(ratio * 100, 0)}%` : '—' },
      ];
      // Unknown ratio / ROE (null) do not block the match — only a definite fail does.
      const ok = checks.every((c) => c.pass !== false);
      return { grade: ok ? 'hedge' : null, checks };
    },
  },
  {
    key: 'discretionary',
    version: 1,
    name: 'Cảm tính / ngoài quy tắc',
    mode: 'OTHER',
    matchable: false,
    summary: 'Vào theo cảm nhận hoặc lý do riêng — ghi lý do để sau này so với các chiến lược có quy tắc.',
  },
];

export function findEntryStrategy(key: string | null | undefined, version?: number | null): EntryStrategyDef | null {
  if (!key) return null;
  const all = ENTRY_STRATEGIES.filter((s) => s.key === key);
  if (version != null) return all.find((s) => s.version === version) ?? null;
  return all.sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Every matchable strategy evaluated on the snapshot (matched or not), for explanations. */
export function evaluateEntryStrategies(f: EntryFeatures | null, ctx: EntryStrategyContext): EntryStrategyResult[] {
  return ENTRY_STRATEGIES.filter((s) => s.matchable && s.evaluate).map((s) => {
    const r = s.evaluate!(f, ctx);
    return { key: s.key, version: s.version, name: s.name, mode: s.mode, grade: r.grade, checks: r.checks };
  });
}

/** Compact list of the strategies this entry matched — what gets stored in `trade_entries.matched`. */
export function matchEntryStrategies(
  f: EntryFeatures | null,
  ctx: EntryStrategyContext,
): Array<{ key: string; version: number; grade: string; mode: EntryMode }> {
  return evaluateEntryStrategies(f, ctx)
    .filter((r) => r.grade != null)
    .map((r) => ({ key: r.key, version: r.version, grade: r.grade!, mode: r.mode }));
}
