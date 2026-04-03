import { Injectable, Optional } from '@nestjs/common';

import { ChatProvider } from '../contracts/chat-provider';
import type { ChatMessage } from '../contracts/chat-message';

type OpenAiChatCompletionChoice = Readonly<{
  message?: Readonly<{
    content?: string | null;
  }>;
}>;

type OpenAiChatCompletionResponse = Readonly<{
  choices?: OpenAiChatCompletionChoice[];
}>;

@Injectable()
export class OpenAiChatProvider extends ChatProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(
    @Optional() model?: string,
    @Optional() apiKey?: string,
    @Optional() fetchImpl?: typeof fetch
  ) {
    super();
    this.model = model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.fetchImpl = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  }

  async chat(messages: readonly ChatMessage[]) {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    if (!this.fetchImpl) {
      throw new Error('No fetch implementation available');
    }

    const response = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI chat request failed with status ${response.status}`);
    }

    const data = (await response.json()) as OpenAiChatCompletionResponse;
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';

    if (!reply) {
      throw new Error('OpenAI chat response was empty');
    }

    return {
      reply,
      model: this.model
    };
  }
}
