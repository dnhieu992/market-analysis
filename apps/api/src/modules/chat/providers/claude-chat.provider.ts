import { tmpdir } from 'node:os';

import { Injectable, Logger } from '@nestjs/common';
import type { Options, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { ChatProvider } from '../contracts/chat-provider';
import type { ChatMessage } from '../contracts/chat-message';
import type { ChatTool } from '../contracts/chat-tool';

/**
 * Chat provider backed by Claude Code (Agent SDK) instead of the Anthropic API.
 *
 * Each call spawns a headless Claude Code session that authenticates with the
 * claude.ai login stored in ~/.claude on this box — no CLAUDE_API_KEY needed.
 * Trading tools are exposed to the session through an in-process MCP server, and
 * all of Claude Code's built-in tools (Bash, Read, Write, …) are disabled.
 */

const MCP_SERVER_NAME = 'trading';
const MAX_TOOL_ITERATIONS = 5;
const QUERY_TIMEOUT_MS = 5 * 60 * 1000;

// Pinned on purpose: CLAUDE_MODEL is shared with the worker's paid API calls, so it must not drive this.
const CHAT_MODEL = 'claude-opus-5-5';

// ESM-only package — load lazily so the CommonJS build (and jest) only touch it at call time.
const loadSdk = () => import('@anthropic-ai/claude-agent-sdk');

/** Converts the flat JSON schemas our ChatTools declare into the zod shape the SDK expects. */
function toZodShape(schema: ChatTool['inputSchema']): Record<string, z.ZodType> {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, raw] of Object.entries(schema.properties)) {
    const prop = raw as { type?: string; description?: string };
    let field: z.ZodType =
      prop.type === 'number' || prop.type === 'integer' ? z.number()
      : prop.type === 'boolean' ? z.boolean()
      : prop.type === 'string' ? z.string()
      : z.unknown();
    if (prop.description) field = field.describe(prop.description);
    shape[key] = required.has(key) ? field : field.optional();
  }

  return shape;
}

/** Claude Code takes a single prompt, so earlier turns are replayed as a transcript. */
function buildPrompt(history: readonly ChatMessage[]): string {
  const turns = history.filter((m) => m.role !== 'system');
  const last = turns[turns.length - 1];
  if (!last) return '';
  if (turns.length === 1) return last.content;

  const transcript = turns
    .slice(0, -1)
    .map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`)
    .join('\n\n');

  return `<conversation_history>
${transcript}
</conversation_history>

Tin nhắn mới nhất của user (trả lời tin nhắn này, dựa trên ngữ cảnh lịch sử ở trên):
${last.content}`;
}

/** Inherit the API's env minus API keys, so Claude Code falls back to the claude.ai login. */
function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_API_KEY;
  env.DISABLE_AUTOUPDATER = '1';
  // The claude.ai login would otherwise pull in the account's connectors (Docs, Drive, …).
  env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'market-analysis-api';
  return env;
}

/** Live progress of a reply, for the chat UI: the current turn's text so far, or the tool being run. */
export type ChatProgressEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string };

export type ChatRunOptions = {
  /** Aborting stops the Claude Code session (the user pressed Stop). */
  signal?: AbortSignal;
  onProgress?: (event: ChatProgressEvent) => void;
};

@Injectable()
export class ClaudeChatProvider extends ChatProvider {
  private readonly logger = new Logger(ClaudeChatProvider.name);
  private readonly model = CHAT_MODEL;

  /** Simple chat (no tools) — satisfies ChatProvider contract */
  async chat(messages: readonly ChatMessage[]) {
    const system = messages.find((m) => m.role === 'system')?.content;
    const reply = await this.runQuery(system, buildPrompt(messages), [], async () => '');
    return { reply: reply || '…', model: this.model };
  }

  /** Core agentic loop with external tool executor */
  async chatAgentLoop(
    systemPrompt: string,
    history: readonly ChatMessage[],
    tools: readonly ChatTool[],
    executeTool: (name: string, input: unknown) => Promise<string>,
    run: ChatRunOptions = {}
  ): Promise<string> {
    return this.runQuery(systemPrompt, buildPrompt(history), tools, executeTool, this.model, run);
  }

  /** Generate a short conversation title from the first user message */
  async generateTitle(firstMessage: string): Promise<string> {
    try {
      const title = await this.runQuery(
        'You generate ultra-short conversation titles. Respond with ONLY 4-7 words, no punctuation, no quotes, no explanation.',
        `Title for: "${firstMessage.slice(0, 300)}"`,
        [],
        async () => '',
        'haiku'
      );
      return title.trim().slice(0, 80) || firstMessage.slice(0, 50).trim();
    } catch {
      return firstMessage.slice(0, 50).trim();
    }
  }

  private async runQuery(
    systemPrompt: string | undefined,
    prompt: string,
    tools: readonly ChatTool[],
    executeTool: (name: string, input: unknown) => Promise<string>,
    model: string = this.model,
    run: ChatRunOptions = {}
  ): Promise<string> {
    const { query, createSdkMcpServer } = await loadSdk();

    const toolDefs: SdkMcpToolDefinition<Record<string, z.ZodType>>[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: toZodShape(t.inputSchema),
      handler: async (args) => {
        let text: string;
        try {
          text = await executeTool(t.name, args);
        } catch (err) {
          text = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        return { content: [{ type: 'text', text }] };
      }
    }));

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), QUERY_TIMEOUT_MS);
    const onAbort = () => abortController.abort();
    if (run.signal?.aborted) abortController.abort();
    run.signal?.addEventListener('abort', onAbort);

    const options: Options = {
      model,
      abortController,
      cwd: tmpdir(),
      env: buildEnv(),
      // Built-in Claude Code tools off; only our trading tools are callable.
      tools: [],
      allowedTools: tools.map((t) => `mcp__${MCP_SERVER_NAME}__${t.name}`),
      permissionMode: 'dontAsk',
      // Only the trading MCP server below — no claude.ai connectors or user/project MCP config.
      strictMcpConfig: true,
      // Adaptive thinking roughly doubled reply latency with no visible gain for these prompts.
      thinking: { type: 'disabled' },
      // Don't pick up ~/.claude settings, CLAUDE.md or plugins from this box.
      settingSources: [],
      persistSession: false,
      maxTurns: MAX_TOOL_ITERATIONS + 1,
      // Token-level stream events, only needed when someone is watching the reply being written.
      includePartialMessages: Boolean(run.onProgress),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(process.env.CLAUDE_CODE_PATH ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH } : {}),
      ...(toolDefs.length > 0
        ? {
            mcpServers: {
              [MCP_SERVER_NAME]: createSdkMcpServer({ name: MCP_SERVER_NAME, tools: toolDefs, alwaysLoad: true })
            }
          }
        : {}),
      stderr: (data) => this.logger.debug(data.trim())
    };

    // Text of the turn being streamed; each new model turn (e.g. after a tool call) starts over,
    // so the last turn's text ends up matching the final result we save.
    let turnText = '';
    try {
      for await (const message of query({ prompt, options })) {
        if (message.type === 'stream_event' && run.onProgress) {
          const ev = message.event;
          if (ev.type === 'message_start') {
            turnText = '';
          } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
            run.onProgress({ type: 'tool', name: ev.content_block.name.replace(`mcp__${MCP_SERVER_NAME}__`, '') });
          } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            turnText += ev.delta.text;
            run.onProgress({ type: 'text', text: turnText });
          }
          continue;
        }
        if (message.type !== 'result') continue;

        if (message.subtype === 'success' && !message.is_error) {
          return message.result.trim();
        }
        if (message.subtype === 'error_max_turns') {
          return 'Xin lỗi, tôi đã đạt giới hạn xử lý. Vui lòng thử lại.';
        }
        const detail = 'errors' in message ? message.errors.join('; ') : message.result;
        throw new Error(`Claude Code error (${message.subtype}): ${detail}`);
      }
      throw new Error('Claude Code exited without a result');
    } finally {
      clearTimeout(timer);
      run.signal?.removeEventListener('abort', onAbort);
    }
  }
}
