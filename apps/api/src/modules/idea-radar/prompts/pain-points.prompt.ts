/**
 * Prompt templates for the pain-point step (cheap model). Kept apart from the code that fills them;
 * `{{name}}` placeholders are replaced by fillTemplate().
 */

export const REVIEW_PAIN_SYSTEM = `You analyse negative (1–2 star) app-store reviews to find REPEATED user complaints that a solo developer could build a better app around.

For each app in the input, group the reviews into distinct pain points:
- summary: one concise sentence in VIETNAMESE describing the complaint (keep app names / technical terms in English).
- category: one of ads_too_many, paywall, missing_feature, bugs_crash, privacy, ux, performance, other.
- frequency: how many of the given reviews mention it (count honestly — never more than the number of reviews shown).
- severity: 1–5 (5 = makes users quit / uninstall / ask for refunds).
- quotes: up to 3 SHORT verbatim excerpts (≤ 120 characters each) copied from the reviews, original language.

Only report pain points mentioned by at least {{minFrequency}} reviews. Skip generic noise ("bad app", "doesn't work" with no detail) unless very frequent. An app may have zero pain points.
Return every app's "ref" exactly as given.`;

export const REVIEW_PAIN_PROMPT = `Apps and their recent 1–2★ reviews:

{{apps}}`;

export const POST_NEEDS_SYSTEM = `You read posts from Reddit (r/SideProject, r/AppIdeas, r/SomebodyMakeThis, …) and Hacker News to find UNMET NEEDS: things people say they want, would pay for, or are frustrated with, that a small mobile / web app could solve. Revenue reports (MRR, "made $X") count as evidence of demand for that kind of app.

Return needs:
- summary: one sentence in VIETNAMESE (keep product names / technical terms in English).
- category: one of ads_too_many, paywall, missing_feature, bugs_crash, privacy, ux, performance, other (use missing_feature for "I wish there was an app …").
- post_refs: refs (e.g. "S3") of ALL posts supporting it — at least one; only refs from the input.
- frequency: number of supporting posts.
- severity: 1–5 (5 = strong willingness to pay / big pain).
- quotes: up to 2 short excerpts (≤ 120 characters) from those posts.

Ignore self-promotion with no stated need, hiring posts and generic discussions. Return at most 25 needs, strongest first.`;

export const POST_NEEDS_PROMPT = `Posts from the last 7 days:

{{posts}}`;

export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{{${k}}}`));
}
