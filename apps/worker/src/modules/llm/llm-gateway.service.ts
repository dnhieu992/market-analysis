import { Inject, Injectable } from '@nestjs/common';
import type {
  DailyAnalysisAnalystDraft,
  DailyAnalysisMarketData,
  DailyAnalysisValidatorResult
} from '@app/core';

import { LLM_PROVIDER_ADAPTER } from './llm-gateway.constants';
import type {
  DailyAnalysisDraftResult,
  DailyAnalysisGatewayInput,
  DailyAnalysisGatewayResult,
  DailyAnalysisValidationResult,
  LlmProviderAdapter
} from './llm-provider.adapter';

export type DailyAnalysisPipelineResult = {
  provider: string;
  model: string;
  draftPlan: DailyAnalysisAnalystDraft;
  validatorResult: DailyAnalysisValidatorResult;
};

@Injectable()
export class LlmGatewayService {
  constructor(
    @Inject(LLM_PROVIDER_ADAPTER)
    private readonly llmProviderAdapter: LlmProviderAdapter
  ) {}

  async runDailyAnalysisPipeline(
    marketData: DailyAnalysisMarketData
  ): Promise<DailyAnalysisPipelineResult> {
    const draftResult: DailyAnalysisDraftResult =
      await this.llmProviderAdapter.generateDailyAnalysisDraft(marketData);
    const validationResult: DailyAnalysisValidationResult =
      await this.llmProviderAdapter.validateDailyAnalysisDraft({
        marketData,
        draftPlan: draftResult.draftPlan
      });

    return {
      provider: draftResult.provider,
      model: draftResult.model,
      draftPlan: draftResult.draftPlan,
      validatorResult: validationResult.validatorResult
    };
  }

  generateDailyAnalysisPlan(
    input: DailyAnalysisGatewayInput
  ): Promise<DailyAnalysisGatewayResult> {
    return this.llmProviderAdapter.generateDailyAnalysisPlan(input);
  }
}
