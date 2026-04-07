import { Module } from '@nestjs/common';

import { LlmGatewayModule } from './llm-gateway.module';
import { LlmService } from './llm.service';
import { OpenAiCompatibleClient } from './openai-compatible.client';

@Module({
  imports: [LlmGatewayModule],
  providers: [OpenAiCompatibleClient, LlmService],
  exports: [OpenAiCompatibleClient, LlmService, LlmGatewayModule]
})
export class LlmModule {}
