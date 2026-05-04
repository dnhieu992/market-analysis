import { Injectable } from '@nestjs/common';

import { ChatProvider } from '../contracts/chat-provider';
import type { ChatMessage } from '../contracts/chat-message';
import type { ChatTool } from '../contracts/chat-tool';

type AnthropicTextBlock     = { type: 'text';        text: string };
type AnthropicToolUseBlock  = { type: 'tool_use';    id: string; name: string; input: unknown };
type AnthropicToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string };
type AnthropicContentBlock  = AnthropicTextBlock | AnthropicToolUseBlock;
type AnthropicUserContent   = string | AnthropicContentBlock[] | AnthropicToolResultBlock[];

type AnthropicResponse = {
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | string;
};

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: AnthropicUserContent;
};

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MAX_TOOL_ITERATIONS = 5;

function resolveModel(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
}

@Injectable()
export class ClaudeChatProvider extends ChatProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    super();
    this.apiKey = process.env.CLAUDE_API_KEY ?? '';
    this.model  = resolveModel();
  }

  /** Simple chat (no tools) — satisfies ChatProvider contract */
  async chat(messages: readonly ChatMessage[]) {
    const result = await this.callApi(undefined, messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })), []);
    const text = result.content
      .filter((b): b is AnthropicTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return { reply: text || '…', model: this.model };
  }

  /** Agentic chat with tools and system prompt — used by ConversationService */
  async chatWithTools(
    systemPrompt: string,
    history: readonly ChatMessage[],
    tools: readonly ChatTool[]
  ): Promise<string> {
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema
    }));

    let messages: AnthropicMessage[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }));

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.callApi(systemPrompt, messages, anthropicTools);

      if (response.stop_reason === 'end_turn') {
        return response.content
          .filter((b): b is AnthropicTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
      }

      if (response.stop_reason === 'tool_use') {
        // Append assistant turn (contains text + tool_use blocks)
        messages = [...messages, { role: 'assistant', content: response.content }];

        // Execute tools and collect results
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            // Tool execution is delegated back to the caller via a callback or registry
            // We store the block for the caller to resolve — here we use a placeholder
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: '{}' });
          }
        }
        messages = [...messages, { role: 'user', content: toolResults }];
      }
    }

    return 'Xin lỗi, tôi không thể hoàn thành yêu cầu của bạn lúc này.';
  }

  /** Core agentic loop with external tool executor */
  async chatAgentLoop(
    systemPrompt: string,
    history: readonly ChatMessage[],
    tools: readonly ChatTool[],
    executeTool: (name: string, input: unknown) => Promise<string>
  ): Promise<string> {
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema
    }));

    let messages: AnthropicMessage[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }));

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.callApi(systemPrompt, messages, anthropicTools);

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        return response.content
          .filter((b): b is AnthropicTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
      }

      if (response.stop_reason === 'tool_use') {
        messages = [...messages, { role: 'assistant', content: response.content }];

        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            let result: string;
            try {
              result = await executeTool(block.name, block.input);
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : String(err)}`;
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          }
        }
        messages = [...messages, { role: 'user', content: toolResults }];
      }
    }

    return 'Xin lỗi, tôi đã đạt giới hạn xử lý. Vui lòng thử lại.';
  }

  private async callApi(
    systemPrompt: string | undefined,
    messages: AnthropicMessage[],
    tools: unknown[]
  ): Promise<AnthropicResponse> {
    if (!this.apiKey) throw new Error('CLAUDE_API_KEY is not set');

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 8096,
      messages
    };
    if (systemPrompt) body.system = systemPrompt;
    if (tools.length > 0) body.tools = tools;

    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Claude API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<AnthropicResponse>;
  }
}
