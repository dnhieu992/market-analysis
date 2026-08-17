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
 * Models:
 *  - `deepseek-chat`     — DeepSeek-V3, the default. Fast, good enough for a
 *                          market brief written from data we hand it.
 *  - `deepseek-reasoner` — DeepSeek-R1. Thinks before answering and returns its
 *                          chain of thought in `reasoning_content`; slower and
 *                          dearer, so it is opt-in via `DEEPSEEK_MODEL`.
 *
 * The key is read from the env at call time (not construction) so a `pm2 restart
 * --update-env` picks it up without a code change.
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
/** A market brief is a few hundred words — this is headroom, not a target. */
const DEFAULT_MAX_TOKENS = 2000;
/** The reasoner can think for a while; the brief itself is never this slow. */
const REQUEST_TIMEOUT_MS = 120_000;

export type DeepseekMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type DeepseekReply = {
  /** The answer itself. */
  content: string;
  /** Chain of thought — only `deepseek-reasoner` fills this in. */
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
