import { z } from 'zod';

import type { IdeaRadarConfig } from '../config';
import type { RadarLlm } from '../llm';
import { fillTemplate } from '../prompts/pain-points.prompt';
import { IDEAS_PROMPT, IDEAS_SYSTEM } from '../prompts/ideas.prompt';
import type { EvidenceRef, MonetizationModel } from '../types';
import type { RawScores } from './scorer';

/**
 * Idea generator: the strongest signals, pain points and posts go to the smart model with short refs
 * (T1…, P1…, S1…); the structured answer is validated with zod and every ref is mapped back to a DB id.
 * An idea that cites no valid evidence is dropped.
 */

export type SignalCtx = { id: string; appTitle: string; store: string; signalType: string; value: number; details: Record<string, unknown> | null; url: string | null };
export type PainCtx = { id: string; appTitle: string | null; summary: string; category: string; frequency: number; severity: number; url: string | null; source: string };
export type PostCtx = { id: string; source: string; title: string; body: string | null; url: string; score: number | null; subreddit?: string | null };
export type PreviousIdea = { title: string; slug: string };

export type GeneratorInput = {
  signals: SignalCtx[]; // ≤ 30, strongest first
  painPoints: PainCtx[]; // ≤ 40, by frequency × severity
  posts: PostCtx[]; // ≤ 30
  previous: PreviousIdea[];
  profile: IdeaRadarConfig['profile'];
  count: number;
};

export type IdeaDraft = {
  title: string;
  slug: string;
  oneLiner: string;
  targetUsers: string;
  problem: string;
  solution: string;
  keyFeatures: string[];
  monetization: { model: MonetizationModel; explanation: string };
  competitors: Array<{ name: string; weakness: string }>;
  evidence: EvidenceRef[];
  rawScores: RawScores;
  repeatOf: string | null;
};

const score = z.number().min(1).max(5);

export const ideasSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string().min(3).max(120),
      one_liner: z.string().min(5),
      target_users: z.string().min(3),
      problem: z.string().min(5),
      solution: z.string().min(5),
      key_features: z.array(z.string()).min(3).max(5),
      monetization: z.object({
        model: z.enum(['ads', 'subscription', 'iap', 'paid', 'hybrid']),
        explanation: z.string(),
      }),
      competitors: z.array(z.object({ name: z.string(), weakness: z.string() })).max(6),
      evidence: z.array(z.string()).min(1),
      repeat_of: z.string().nullable(),
      scores: z.object({ demand: score, competition: score, monetization: score, effort: score }),
    }),
  ),
});

export type IdeasOutput = z.infer<typeof ideasSchema>;

/** ASCII slug (Vietnamese diacritics stripped) — used to spot repeats across runs. */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function describeSignal(s: SignalCtx): string {
  const d = s.details ?? {};
  const where = [d.country, d.chart, d.category].filter(Boolean).join('/');
  switch (s.signalType) {
    case 'rank_jump':
      return `tăng ${s.value} hạng (${d.from} → ${d.to}) ${where}`;
    case 'new_entry':
      return `mới vào top, hạng ${s.value} ${where}`;
    case 'fast_growth':
      return `số đánh giá +${s.value}% (${d.from} → ${d.to}) ${where}`;
    case 'rating_drop':
      return `điểm giảm ${s.value} (${d.from} → ${d.to}) ${where}`;
    default:
      return `${s.signalType} ${s.value}`;
  }
}

export function buildIdeasPrompt(input: GeneratorInput): { system: string; prompt: string } {
  const profile = [
    `- Vai trò: ${input.profile.role}`,
    `- Kỹ năng: ${input.profile.skills.join(', ')}`,
    `- Thời gian: ${input.profile.time_per_week_hours} giờ/tuần`,
    `- Ngân sách: $${input.profile.budget_usd}`,
    `- Thị trường: ${input.profile.target_markets.join(', ')}`,
    `- Kiếm tiền ưu tiên: ${input.profile.preferred_monetization.join(', ')}`,
  ].join('\n');

  const signals = input.signals.map((s, i) => `- T${i + 1} ${s.appTitle} (${s.store}): ${describeSignal(s)}`).join('\n') || '(không có)';
  const pains =
    input.painPoints
      .map((p, i) => `- P${i + 1} [${p.category}, ${p.frequency}×, mức ${p.severity}] ${p.appTitle ? `${p.appTitle}: ` : '(cộng đồng) '}${oneLine(p.summary)}`)
      .join('\n') || '(không có)';
  const posts =
    input.posts
      .map((p, i) => {
        const where = p.source === 'reddit' ? `r/${p.subreddit ?? '?'}` : `HN${p.score ? ` ${p.score}đ` : ''}`;
        return `- S${i + 1} [${where}] ${oneLine(clip(p.title, 160))}${p.body ? ` — ${oneLine(clip(p.body, 200))}` : ''}`;
      })
      .join('\n') || '(không có)';
  const previous = input.previous.map((p) => `- ${p.title}`).join('\n') || '(chưa có)';

  return {
    system: fillTemplate(IDEAS_SYSTEM, { count: input.count, profile }),
    prompt: fillTemplate(IDEAS_PROMPT, { signals, painPoints: pains, posts, previous, count: input.count }),
  };
}

/** Map T/P/S refs back to evidence rows; unknown refs are dropped. */
export function resolveEvidence(refs: string[], input: Pick<GeneratorInput, 'signals' | 'painPoints' | 'posts'>): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const m = ref.trim().match(/^([TPS])(\d+)$/i);
    if (!m) continue;
    const idx = Number(m[2]) - 1;
    const kind = (m[1] ?? '').toUpperCase();
    let ev: EvidenceRef | null = null;
    if (kind === 'T') {
      const s = input.signals[idx];
      if (s) ev = { type: 'trend_signal', id: s.id, label: `${s.appTitle}: ${describeSignal(s)}`, url: s.url };
    } else if (kind === 'P') {
      const p = input.painPoints[idx];
      if (p) ev = { type: 'pain_point', id: p.id, label: `${p.appTitle ? `${p.appTitle}: ` : ''}${p.summary} (${p.frequency}×)`, url: p.url };
    } else {
      const p = input.posts[idx];
      if (p) ev = { type: 'post', id: p.id, label: `${p.source === 'reddit' ? `r/${p.subreddit ?? '?'}` : 'HN'}: ${p.title}`, url: p.url };
    }
    if (ev && !seen.has(ev.id)) {
      seen.add(ev.id);
      out.push(ev);
    }
  }
  return out;
}

export function toDrafts(out: IdeasOutput, input: GeneratorInput): IdeaDraft[] {
  const prevByTitle = new Map(input.previous.map((p) => [p.title.trim().toLowerCase(), p]));
  const prevSlugs = new Map(input.previous.map((p) => [p.slug, p]));
  const drafts: IdeaDraft[] = [];
  for (const idea of out.ideas) {
    const evidence = resolveEvidence(idea.evidence, input);
    if (!evidence.length) continue; // no evidence → not an idea
    const slug = slugify(idea.title);
    const repeat = (idea.repeat_of ? prevByTitle.get(idea.repeat_of.trim().toLowerCase()) : undefined) ?? prevSlugs.get(slug);
    drafts.push({
      title: idea.title.trim(),
      slug,
      oneLiner: idea.one_liner.trim(),
      targetUsers: idea.target_users.trim(),
      problem: idea.problem.trim(),
      solution: idea.solution.trim(),
      keyFeatures: idea.key_features.map((f) => f.trim()),
      monetization: { model: idea.monetization.model, explanation: idea.monetization.explanation.trim() },
      competitors: idea.competitors,
      evidence,
      rawScores: {
        demand: idea.scores.demand,
        competition: idea.scores.competition,
        monetization: idea.scores.monetization,
        effort: idea.scores.effort,
      },
      repeatOf: repeat?.title ?? null,
    });
  }
  // Prefer ideas with ≥ 2 pieces of evidence; keep thinner ones only if too few remain.
  const solid = drafts.filter((d) => d.evidence.length >= 2);
  return solid.length >= Math.min(5, drafts.length) ? solid : drafts;
}

export async function generateIdeas(llm: RadarLlm | null, input: GeneratorInput, model: string): Promise<IdeaDraft[]> {
  if (!llm) return dryRunIdeas(input);
  const { system, prompt } = buildIdeasPrompt(input);
  const out = await llm.structured('ideas', model, system, prompt, ideasSchema, { timeoutMs: 12 * 60_000 });
  return toDrafts(out, input);
}

/** Dry-run: deterministic ideas built from the top pain points, each citing a pain point + a signal / post. */
export function dryRunIdeas(input: GeneratorInput): IdeaDraft[] {
  const out: IdeasOutput = { ideas: [] };
  const extras = [...input.signals.map((_, i) => `T${i + 1}`), ...input.posts.map((_, i) => `S${i + 1}`)];
  input.painPoints.slice(0, input.count).forEach((p, i) => {
    const subject = p.appTitle ?? 'cộng đồng';
    out.ideas.push({
      title: `[dry-run] Giải pháp cho ${subject} #${i + 1}`,
      one_liner: `App tập trung giải quyết: ${p.summary}`,
      target_users: `Người dùng ${subject} đang bức xúc`,
      problem: p.summary,
      solution: 'Một app gọn, làm đúng một việc, không có vấn đề trên.',
      key_features: ['Tính năng cốt lõi', 'Đồng bộ đơn giản', 'Không quảng cáo xâm lấn'],
      monetization: { model: 'subscription', explanation: 'Miễn phí cơ bản, $2.99/tháng cho bản Pro.' },
      competitors: p.appTitle ? [{ name: p.appTitle, weakness: p.summary }] : [],
      evidence: [`P${i + 1}`, ...(extras[i] ? [extras[i]] : [])],
      repeat_of: null,
      scores: { demand: Math.min(5, 2 + Math.round(p.frequency / 10)), competition: 3, monetization: 3, effort: 4 },
    });
  });
  return toDrafts(out, input);
}
