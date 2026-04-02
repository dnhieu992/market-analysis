import { Module } from '@nestjs/common';

import { LlmService } from './llm.service';
import { OpenAiCompatibleClient } from './openai-compatible.client';

@Module({
  providers: [OpenAiCompatibleClient, LlmService],
  exports: [OpenAiCompatibleClient, LlmService]
})
export class LlmModule {}
