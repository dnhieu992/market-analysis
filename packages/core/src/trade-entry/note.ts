import type { EntryFeatures } from './features';
import { findEntryStrategy, type EntryMode } from './strategies';

const SOURCE_VI: Record<string, string> = {
  AI_CARD: 'thẻ AI chat',
  SETUP_TAB: 'tab Setup',
  LIMIT: 'lệnh LIMIT',
  AUTO: 'auto-trade',
  EXCHANGE_APP: 'app sàn (không qua web)',
  BACKFILL: 'bổ sung từ lịch sử',
};

const f1 = (n: number | null | undefined, suffix = '') => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)}${suffix}`);
const signed = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`);

/** One-line market snapshot, e.g. "QQE D1 long (3 nến) · H4 short · RSI H4 38.2 · 1h 31.0 · EMA89 D1 +8.1% · 24h −2.3% · 7d +4.0%". */
export function formatEntryFeaturesLine(f: EntryFeatures | null | undefined): string {
  if (!f) return 'không có dữ liệu nến Binance cho coin này';
  return [
    `QQE D1 ${f.qqeD1 ?? '—'}${f.qqeD1BarsSinceCross != null ? ` (${f.qqeD1BarsSinceCross} nến)` : ''} · H4 ${f.qqeH4 ?? '—'}`,
    `RSI H4 ${f1(f.rsiH4)} · 1h ${f1(f.rsi1h)} · D1 ${f1(f.rsiD1)}`,
    `EMA89 D1 ${signed(f.distEma89D1Pct)} · EMA34 D1 ${signed(f.distEma34D1Pct)}`,
    `24h ${signed(f.chg24hPct)} · 7d ${signed(f.chg7dPct)}`,
    f.d1Structure !== undefined
      ? `D1 ${f.d1Structure === 'up' ? 'HH+HL' : f.d1Structure === 'down' ? 'LH+LL' : f.d1Structure === 'mixed' ? 'đi ngang' : '—'}${f.paSweepH4 ? ` · quét đáy H4 ${f.paSweepH4.sweptLow}` : ''}`
      : '',
    f.btc ? `BTC 7d ${signed(f.btc.chg7dPct)}, QQE D1 ${f.btc.qqeD1 ?? '—'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export type EntryNoteInput = {
  event: 'OPEN' | 'DCA';
  source: string;
  strategyKey?: string | null;
  strategyVersion?: number | null;
  grade?: string | null;
  mode?: string | null;
  reason?: string | null;
  tags?: unknown;
  features?: EntryFeatures | null;
  matched?: Array<{ key: string; version: number; grade: string; mode: EntryMode }> | null;
  plan?: { takeProfitPrice?: number | null } | null;
};

/** The "🧭 Lý do vào lệnh" system note written to a trade's journal. */
export function formatEntryReasonNote(e: EntryNoteInput): string {
  const declared = findEntryStrategy(e.strategyKey, e.strategyVersion);
  const head = e.event === 'DCA' ? '🧭 **Lý do DCA**' : '🧭 **Lý do vào lệnh**';
  const lines = [`${head} — nguồn: ${SOURCE_VI[e.source] ?? e.source}`];
  if (declared) {
    lines.push(`- Chiến lược: **${declared.name}** (v${declared.version})${e.grade ? ` · hạng ${e.grade}` : ''}${e.mode ? ` · ${e.mode}` : ''}`);
  } else if (e.strategyKey) {
    lines.push(`- Chiến lược: ${e.strategyKey}${e.grade ? ` · hạng ${e.grade}` : ''}`);
  } else {
    lines.push('- Chiến lược: _chưa khai báo_');
  }
  if (e.reason?.trim()) lines.push(`- Lý do: ${e.reason.trim().slice(0, 1000)}`);
  const tags = Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string' && t.trim()) : [];
  if (tags.length) lines.push(`- Tag: ${tags.map((t) => `#${String(t).trim()}`).join(' ')}`);
  if (e.plan?.takeProfitPrice) lines.push(`- TP dự kiến: ${e.plan.takeProfitPrice}`);
  const matched = e.matched ?? [];
  lines.push(
    `- Khớp quy tắc lúc vào: ${
      matched.length
        ? matched.map((m) => `${findEntryStrategy(m.key, m.version)?.name ?? m.key} — ${m.grade}`).join('; ')
        : 'không khớp chiến lược nào'
    }`,
  );
  lines.push(`- Bối cảnh: ${formatEntryFeaturesLine(e.features)}`);
  return lines.join('\n');
}
