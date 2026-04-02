import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildAnalysisPrompt,
  llmSignalSchema,
  normalizeLlmSignal
} from '@app/core';
import type { IndicatorSnapshot, LlmSignal } from '@app/core';

import { OpenAiCompatibleClient } from './openai-compatible.client';

type AnalyzeMarketInput = {
  symbol: string;
  timeframe: string;
  indicators: IndicatorSnapshot;
};

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(OpenAiCompatibleClient)
    private readonly openAiCompatibleClient: OpenAiCompatibleClient
  ) {}

  async analyzeMarket(input: AnalyzeMarketInput): Promise<LlmSignal> {
    const prompt = buildAnalysisPrompt(input);
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.openAiCompatibleClient.createChatCompletion(prompt);
        const parsed = JSON.parse(response) as unknown;

        return normalizeLlmSignal(llmSignalSchema.parse(parsed));
      } catch {
        this.logger.warn(`Invalid LLM output on attempt ${attempt}/${maxAttempts}`);
        if (attempt === maxAttempts) {
          break;
        }
      }
    }

    throw new Error(`Failed to generate valid LLM signal after ${maxAttempts} attempts`);
  }
}
