import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

/**
 * Minimal DeepSeek client.
 *
 * DeepSeek's API is OpenAI-compatible (`POST /chat/completions`, bearer auth), so
 * this is deliberately the same shape as `OpenAiChatProvider` rather than a new
 * abstraction — the only real differences are the host, the model ids, and the
 * extra `reasoning_content` field the reasoner model returns.
 *
 * Models (the V3-era `deepseek-chat` / `deepseek-reasoner` names were retired on
 * 2026-07-24 and are gone — both V4 models cover their roles via thinking mode):
 *  - `deepseek-v4-pro`   — DeepSeek-V4-Pro-0813, the default.
 *  - `deepseek-v4-flash` — DeepSeek-V4-Flash-0731. Cheaper and faster.
 *
 * V4 thinks by default at `reasoning_effort: high` and that is what we keep;
 * `DEEPSEEK_REASONING_EFFORT` can drop it to `low` or push it to `max`. Whatever
 * it thinks comes back in `reasoning_content` and the UI shows it under "Quá
 * trình suy luận". Note that thinking mode ignores `temperature`, `top_p`,
 * `presence_penalty` and `frequency_penalty` — they are accepted and dropped.
 *
 * The key is read from the env at call time (not construction) so a `pm2 restart
 * --update-env` picks it up without a code change.
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-pro';
/** `low` | `high` | `max` — DeepSeek's own default is `high`. */
const DEFAULT_REASONING_EFFORT = 'high';
/**
 * A market brief is a few hundred words, but on V4 the thinking tokens draw on
 * the same budget — too tight a cap and the answer comes back empty.
 */
const DEFAULT_MAX_TOKENS = 8000;
/** Thinking can take a while; the brief itself is never this slow. */
const REQUEST_TIMEOUT_MS = 120_000;

export type DeepseekMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type DeepseekReply = {
  /** The answer itself. */
  content: string;
  /** Chain of thought — only filled in when the model thought before answering. */
  reasoning: string | null;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
};

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

@Injectable()
export class DeepseekClient {
  private readonly logger = new Logger(DeepseekClient.name);
  private readonly http: AxiosInstance = axios.create({
    baseURL: process.env.DEEPSEEK_API_BASE_URL ?? DEFAULT_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
  });

  private get apiKey(): string {
    return process.env.DEEPSEEK_API_KEY ?? '';
  }

  /** Model every call uses unless one is passed explicitly. */
  get model(): string {
    return process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  }

  private get reasoningEffort(): string {
    return process.env.DEEPSEEK_REASONING_EFFORT ?? DEFAULT_REASONING_EFFORT;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * One non-streaming chat completion. Throws on a missing key, a transport
   * failure, or an empty answer — the caller turns those into an HTTP status,
   * because silently returning "" would render as a blank analysis panel.
   */
  async chat(
    messages: DeepseekMessage[],
    opts: { model?: string; temperature?: number; maxTokens?: number } = {},
  ): Promise<DeepseekReply> {
    if (!this.isConfigured()) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }

    const model = opts.model ?? this.model;
    const res = await this.http.post<ChatCompletionResponse>(
      '/chat/completions',
      {
        model,
        messages,
        stream: false,
        // A market brief must stick to the numbers it was given, so temperature
        // stays low — this is summarisation, not ideation.
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        reasoning_effort: this.reasoningEffort,
      },
      { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' } },
    );

    const choice = res.data?.choices?.[0];
    const content = choice?.message?.content?.trim() ?? '';
    if (!content) {
      this.logger.warn(`DeepSeek returned an empty answer (finish_reason: ${choice?.finish_reason ?? 'n/a'})`);
      throw new Error('DeepSeek trả về câu trả lời rỗng');
    }

    const usage = res.data?.usage;
    return {
      content,
      reasoning: choice?.message?.reasoning_content?.trim() || null,
      model: res.data?.model ?? model,
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          }
        : null,
    };
  }
}
