import { Module } from '@nestjs/common';

import { ClaudeDailyAnalysisProvider } from './claude-daily-analysis.provider';
import { LLM_PROVIDER_ADAPTER } from './llm-gateway.constants';
import { LlmGatewayService } from './llm-gateway.service';
import type { ClaudeModelVariant, LlmProviderName } from './llm-provider.adapter';

export function resolveLlmGatewayConfig(): {
  provider: LlmProviderName;
  claudeModelVariant: ClaudeModelVariant;
} {
  const provider = (process.env.LLM_PROVIDER ?? 'claude') as string;
  const claudeModelVariant = (process.env.CLAUDE_MODEL ?? 'sonnet') as string;

  if (provider !== 'claude' && provider !== 'openai' && provider !== 'gemini') {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  return {
    provider,
    claudeModelVariant
  };
}

@Module({
  providers: [
    {
      provide: ClaudeDailyAnalysisProvider,
      useFactory: () => {
        const { claudeModelVariant } = resolveLlmGatewayConfig();
        return new ClaudeDailyAnalysisProvider(undefined, claudeModelVariant);
      }
    },
    {
      provide: LLM_PROVIDER_ADAPTER,
      useFactory: (claudeProvider: ClaudeDailyAnalysisProvider) => {
        const { provider } = resolveLlmGatewayConfig();

        if (provider === 'claude') {
          return claudeProvider;
        }

        throw new Error(`Unsupported LLM provider: ${provider}`);
      },
      inject: [ClaudeDailyAnalysisProvider]
    },
    LlmGatewayService
  ],
  exports: [LLM_PROVIDER_ADAPTER, LlmGatewayService, ClaudeDailyAnalysisProvider]
})
export class LlmGatewayModule {}
