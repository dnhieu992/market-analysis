import { z } from 'zod';

import type { StructuredAnswer } from '../chat/providers/claude-chat.provider';

/**
 * Claude gateway for the pipeline. Calls go through headless Claude Code (ClaudeChatProvider.askStructured,
 * the claude.ai login on this box), with:
 *  - a monthly budget guard on the SDK's cost estimate (the LLM steps stop once the month is over budget),
 *  - one usage row per call (step, model, tokens, cost),
 *  - zod validation of the structured output, retried once with the validation errors.
 */

export type StructuredAsker = {
  askStructured(
    systemPrompt: string,
    prompt: string,
    schema: Record<string, unknown>,
    opts?: { model?: string; timeoutMs?: number },
  ): Promise<StructuredAnswer>;
};

export type LlmUsageRecord = { step: string; model: string; inputTokens: number; outputTokens: number; costUsd: number };

export interface LlmUsageSink {
  monthCostUsd(): Promise<number>;
  recordUsage(u: LlmUsageRecord): Promise<void>;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super(`Vượt ngân sách LLM tháng này: $${spentUsd.toFixed(2)} / $${budgetUsd.toFixed(2)}`);
  }
}

export class LlmOutputError extends Error {}

/** Pull a JSON object out of a text reply (fallback when no structured output came back). */
export function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

const formatIssues = (err: z.ZodError) =>
  err.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');

export class RadarLlm {
  constructor(
    private readonly claude: StructuredAsker,
    private readonly usage: LlmUsageSink,
    private readonly budgetUsd: number,
  ) {}

  async assertBudget(): Promise<void> {
    const spent = await this.usage.monthCostUsd();
    if (spent >= this.budgetUsd) throw new BudgetExceededError(spent, this.budgetUsd);
  }

  async structured<T>(
    step: string,
    model: string,
    system: string,
    prompt: string,
    schema: z.ZodType<T>,
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    delete jsonSchema.$schema;

    let currentPrompt = prompt;
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.assertBudget();
      const ans = await this.claude.askStructured(system, currentPrompt, jsonSchema, { model, timeoutMs: opts.timeoutMs ?? 8 * 60_000 });
      await this.usage.recordUsage({
        step,
        model,
        inputTokens: ans.inputTokens,
        outputTokens: ans.outputTokens,
        costUsd: ans.costUsd,
      });

      const raw = ans.structuredOutput ?? extractJson(ans.text);
      const parsed = schema.safeParse(raw);
      if (parsed.success) return parsed.data;

      lastError = raw === null ? 'Không có JSON trong câu trả lời.' : formatIssues(parsed.error);
      currentPrompt = `${prompt}\n\n---\nLần trả lời trước KHÔNG hợp lệ với schema:\n${lastError}\nHãy trả lời lại, đúng schema.`;
    }
    throw new LlmOutputError(`${step}: output không hợp lệ sau 2 lần — ${lastError.slice(0, 300)}`);
  }
}

/** Run async jobs with a small concurrency limit (each Claude Code session is a ~250 MB process). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}
