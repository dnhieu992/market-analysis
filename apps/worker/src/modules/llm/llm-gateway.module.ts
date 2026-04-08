import { Module } from '@nestjs/common';

import { ClaudeDailyAnalysisProvider } from './claude-daily-analysis.provider';
import { LLM_PROVIDER_ADAPTER } from './llm-gateway.constants';
import { LlmGatewayService } from './llm-gateway.service';
import type { ClaudeModelVariant } from './llm-provider.adapter';

export type RuntimeLlmProvider = 'claude';

export function resolveLlmGatewayConfig(): {
  provider: RuntimeLlmProvider;
  claudeModelVariant: ClaudeModelVariant;
} {
  const provider = process.env.LLM_PROVIDER;
  const claudeModelVariant = (process.env.CLAUDE_MODEL ?? 'sonnet') as string;

  if (provider != null && provider !== 'claude') {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  return {
    provider: 'claude',
    claudeModelVariant
  };
}

export function createLlmProviderAdapter(): ClaudeDailyAnalysisProvider {
  const { claudeModelVariant } = resolveLlmGatewayConfig();

  return new ClaudeDailyAnalysisProvider(undefined, claudeModelVariant);
}

@Module({
  providers: [
    {
      provide: ClaudeDailyAnalysisProvider,
      useFactory: createLlmProviderAdapter
    },
    {
      provide: LLM_PROVIDER_ADAPTER,
      useFactory: (claudeProvider: ClaudeDailyAnalysisProvider) => claudeProvider,
      inject: [ClaudeDailyAnalysisProvider]
    },
    LlmGatewayService
  ],
  exports: [LLM_PROVIDER_ADAPTER, LlmGatewayService, ClaudeDailyAnalysisProvider]
})
export class LlmGatewayModule {}
