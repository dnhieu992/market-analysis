import { Inject, Injectable } from '@nestjs/common';

import { LLM_PROVIDER_ADAPTER } from './llm-gateway.constants';
import type {
  DailyAnalysisGatewayInput,
  DailyAnalysisGatewayResult,
  LlmProviderAdapter
} from './llm-provider.adapter';

@Injectable()
export class LlmGatewayService {
  constructor(
    @Inject(LLM_PROVIDER_ADAPTER)
    private readonly llmProviderAdapter: LlmProviderAdapter
  ) {}

  generateDailyAnalysisPlan(
    input: DailyAnalysisGatewayInput
  ): Promise<DailyAnalysisGatewayResult> {
    return this.llmProviderAdapter.generateDailyAnalysisPlan(input);
  }
}
