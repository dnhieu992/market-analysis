import type { EvidenceRef, RunError } from '../types';

/** Markdown report (Vietnamese) + the short Telegram summary. Pure functions — the service gathers the data. */

export type ReportIdea = {
  title: string;
  oneLiner: string;
  targetUsers: string;
  problem: string;
  solution: string;
  keyFeatures: string[];
  monetization: { model: string; explanation: string };
  competitors: Array<{ name: string; weakness: string }>;
  evidence: EvidenceRef[];
  scores: { demand: number; competition: number; monetization: number; effort: number; total: number };
  repeatOf: string | null;
};

export type ReportTrend = { appTitle: string; store: string; url: string | null; signalType: string; value: number; details: Record<string, unknown> | null };
export type ReportPain = { appTitle: string | null; summary: string; category: string; frequency: number; severity: number; quotes: string[] };

export type ReportStats = {
  appsTracked: number;
  snapshots: number;
  reviewsAnalyzed: number;
  postsAnalyzed: number;
  signals: number;
  painPoints: number;
  llmCostUsd: number;
};

export type ReportData = {
  runDate: string;
  dryRun: boolean;
  stats: ReportStats;
  ideas: ReportIdea[];
  trends: ReportTrend[];
  painPoints: ReportPain[];
  errors: RunError[];
  pageUrl?: string | null;
};

const STORE_LABEL: Record<string, string> = { google_play: 'Google Play', app_store: 'App Store' };
const SIGNAL_LABEL: Record<string, string> = {
  rank_jump: 'Tăng hạng',
  new_entry: 'Mới vào top',
  fast_growth: 'Đánh giá tăng nhanh',
  rating_drop: 'Điểm giảm',
};
const CATEGORY_LABEL: Record<string, string> = {
  ads_too_many: 'Quảng cáo',
  paywall: 'Paywall',
  missing_feature: 'Thiếu tính năng',
  bugs_crash: 'Lỗi / crash',
  privacy: 'Riêng tư',
  ux: 'UX',
  performance: 'Hiệu năng',
  other: 'Khác',
};
const MONETIZATION_LABEL: Record<string, string> = {
  ads: 'Quảng cáo',
  subscription: 'Thuê bao',
  iap: 'Mua trong app',
  paid: 'Trả tiền một lần',
  hybrid: 'Kết hợp',
};

/** Escape characters that would break a Markdown table cell / inline text. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const link = (label: string, url: string | null) => (url ? `[${cell(label)}](${url})` : cell(label));
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function describeTrend(t: Pick<ReportTrend, 'signalType' | 'value' | 'details'>): string {
  const d = t.details ?? {};
  const where = [d.country ? String(d.country).toUpperCase() : null, d.chart, d.category].filter(Boolean).join(' · ');
  switch (t.signalType) {
    case 'rank_jump':
      return `+${t.value} hạng (#${d.from} → #${d.to}) · ${where}`;
    case 'new_entry':
      return `vào top ở hạng #${t.value} · ${where}`;
    case 'fast_growth':
      return `+${t.value}% đánh giá (${d.from} → ${d.to}) · ${where}`;
    case 'rating_drop':
      return `−${t.value} điểm (${d.from} → ${d.to}) · ${where}`;
    default:
      return `${t.value}`;
  }
}

export function summaryLines(r: ReportData): string[] {
  const s = r.stats;
  const lines = [
    `Theo dõi **${s.appsTracked}** app (${s.snapshots} snapshot), phân tích **${s.reviewsAnalyzed}** review 1–2★ và **${s.postsAnalyzed}** bài Reddit / HN.`,
    `Phát hiện **${s.signals}** tín hiệu xu hướng và **${s.painPoints}** pain point; sinh **${r.ideas.length}** ý tưởng.`,
  ];
  const top = r.ideas[0];
  if (top) lines.push(`Nổi bật: **${top.title}** (${fmt(top.scores.total)} điểm) — ${top.oneLiner}`);
  const strongest = r.trends[0];
  if (strongest) lines.push(`Xu hướng mạnh nhất: ${strongest.appTitle} — ${describeTrend(strongest)}.`);
  if (r.errors.length) lines.push(`⚠️ ${r.errors.length} lỗi thu thập / phân tích (xem cuối báo cáo).`);
  return lines;
}

function renderIdea(idea: ReportIdea, i: number): string {
  const s = idea.scores;
  const out = [
    `### ${i + 1}. ${idea.title}${idea.repeatOf ? ' 🔁' : ''}`,
    '',
    `**Điểm ${fmt(s.total)}** · nhu cầu ${fmt(s.demand)} · cạnh tranh ${fmt(s.competition)} · kiếm tiền ${fmt(s.monetization)} · công sức ${fmt(s.effort)}`,
    '',
    `> ${idea.oneLiner}`,
    '',
    `- **Người dùng:** ${idea.targetUsers}`,
    `- **Vấn đề:** ${idea.problem}`,
    `- **Giải pháp:** ${idea.solution}`,
    `- **Kiếm tiền:** ${MONETIZATION_LABEL[idea.monetization.model] ?? idea.monetization.model} — ${idea.monetization.explanation}`,
  ];
  if (idea.repeatOf) out.push(`- **Lặp lại từ kỳ trước:** ${idea.repeatOf}`);
  out.push('', '**Tính năng MVP:**', ...idea.keyFeatures.map((f) => `- ${f}`));
  if (idea.competitors.length) out.push('', '**Đối thủ:**', ...idea.competitors.map((c) => `- ${c.name} — ${c.weakness}`));
  out.push('', '**Bằng chứng:**', ...idea.evidence.map((e) => `- ${link(e.label, e.url)}`));
  return out.join('\n');
}

export function renderReport(r: ReportData): string {
  const parts: string[] = [];
  parts.push(`# App Idea Radar — ${r.runDate}${r.dryRun ? ' (dry-run)' : ''}`, '');
  if (r.dryRun) parts.push('> Dry-run: không gọi Claude — pain point và ý tưởng là dữ liệu giả để kiểm tra pipeline.', '');

  parts.push('## Tóm tắt kỳ này', '', ...summaryLines(r).map((l) => `- ${l}`), '');

  parts.push('## Top ý tưởng', '');
  if (r.ideas.length) parts.push(r.ideas.map(renderIdea).join('\n\n'), '');
  else parts.push('_Không có ý tưởng nào kỳ này._', '');

  parts.push('## Xu hướng đáng chú ý', '');
  if (r.trends.length) {
    parts.push('| App | Store | Tín hiệu | Chi tiết |', '|---|---|---|---|');
    for (const t of r.trends) {
      parts.push(`| ${link(t.appTitle, t.url)} | ${STORE_LABEL[t.store] ?? t.store} | ${SIGNAL_LABEL[t.signalType] ?? t.signalType} | ${cell(describeTrend(t))} |`);
    }
  } else {
    parts.push('_Chưa có tín hiệu (cần ít nhất 2 kỳ dữ liệu để so sánh)._');
  }
  parts.push('');

  parts.push('## Pain point lớn nhất', '');
  if (r.painPoints.length) {
    parts.push('| # | App | Loại | Tần suất | Mức độ | Pain point |', '|---|---|---|---|---|---|');
    r.painPoints.forEach((p, i) => {
      const quote = p.quotes[0] ? ` _“${cell(p.quotes[0])}”_` : '';
      parts.push(`| ${i + 1} | ${cell(p.appTitle ?? 'Cộng đồng')} | ${CATEGORY_LABEL[p.category] ?? p.category} | ${p.frequency} | ${p.severity}/5 | ${cell(p.summary)}${quote} |`);
    });
  } else {
    parts.push('_Không có._');
  }
  parts.push('');

  const repeats = r.ideas.filter((i) => i.repeatOf);
  parts.push('## Ý tưởng lặp lại (tín hiệu mạnh lên)', '');
  if (repeats.length) parts.push(...repeats.map((i) => `- **${i.title}** (${fmt(i.scores.total)} điểm) — trước đây: ${i.repeatOf}`));
  else parts.push('_Không có._');
  parts.push('');

  if (r.errors.length) {
    parts.push('## Lỗi thu thập', '', ...r.errors.map((e) => `- **${e.source}:** ${e.message}`), '');
  }

  if (r.stats.llmCostUsd > 0) parts.push(`_Chi phí Claude ước tính kỳ này: $${r.stats.llmCostUsd.toFixed(2)}._`, '');
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ── Telegram (HTML parse mode) ────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Top 3 ideas, 2–3 lines each; always < 4096 chars. */
export function renderTelegramSummary(r: ReportData): string {
  const lines = [`<b>💡 App Idea Radar — ${esc(r.runDate)}</b>${r.dryRun ? ' (dry-run)' : ''}`, ''];
  r.ideas.slice(0, 3).forEach((idea, i) => {
    lines.push(`<b>${i + 1}. ${esc(idea.title)}</b> — ${fmt(idea.scores.total)}đ${idea.repeatOf ? ' 🔁' : ''}`);
    lines.push(esc(idea.oneLiner.slice(0, 300)));
    lines.push(`<i>${esc(MONETIZATION_LABEL[idea.monetization.model] ?? idea.monetization.model)} · ${idea.evidence.length} bằng chứng</i>`, '');
  });
  if (!r.ideas.length) lines.push('Không có ý tưởng nào kỳ này.', '');
  const s = r.stats;
  lines.push(`${s.appsTracked} app · ${s.reviewsAnalyzed} review · ${s.postsAnalyzed} bài · ${s.signals} tín hiệu`);
  if (r.errors.length) lines.push(`⚠️ ${r.errors.length} lỗi thu thập`);
  if (r.pageUrl) lines.push(`<a href="${esc(r.pageUrl)}">Xem đầy đủ</a>`);
  return lines.join('\n').slice(0, 4000);
}
