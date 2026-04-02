import { Injectable, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

type PromptPayload = {
  system: string;
  user: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

@Injectable()
export class OpenAiCompatibleClient {
  private readonly client: AxiosInstance;
  private readonly model: string;

  constructor(
    @Optional() client?: AxiosInstance,
    @Optional() model?: string,
    @Optional() apiKey?: string
  ) {
    const resolvedModel = model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const resolvedApiKey = apiKey ?? process.env.OPENAI_API_KEY ?? '';

    this.model = resolvedModel;
    this.client =
      client ??
      axios.create({
        baseURL: 'https://api.openai.com/v1',
        timeout: 20_000,
        headers: {
          Authorization: `Bearer ${resolvedApiKey}`,
          'Content-Type': 'application/json'
        }
      });
  }

  async createChatCompletion(prompt: PromptPayload): Promise<string> {
    const response = await this.client.post<ChatCompletionResponse>('/chat/completions', {
      model: this.model,
      response_format: {
        type: 'json_object'
      },
      messages: [
        {
          role: 'system',
          content: prompt.system
        },
        {
          role: 'user',
          content: prompt.user
        }
      ]
    });

    return response.data.choices?.[0]?.message?.content ?? '';
  }
}
