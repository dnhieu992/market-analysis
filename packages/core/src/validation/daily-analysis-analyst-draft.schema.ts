import { z } from 'zod';

import {
  dailyAnalysisBiasSchema,
  dailyAnalysisCheckResultSchema,
  dailyAnalysisMarketStateSchema,
  dailyAnalysisSetupSchema,
  dailyAnalysisSetupTypeSchema,
  dailyAnalysisStatusSchema,
  dailyAnalysisTimeframeContextSchema
} from './daily-analysis-plan.schema';

export const dailyAnalysisAnalystDraftSchema = z
  .object({
    summary: z.string().min(1),
    bias: dailyAnalysisBiasSchema,
    confidence: z.number().int().min(0).max(100),
    status: dailyAnalysisStatusSchema,
    timeframeContext: dailyAnalysisTimeframeContextSchema,
    marketState: dailyAnalysisMarketStateSchema,
    setupType: dailyAnalysisSetupTypeSchema,
    noTradeZone: z.string().min(1),
    primarySetup: dailyAnalysisSetupSchema,
    secondarySetup: dailyAnalysisSetupSchema,
    atrConsistencyCheck: z
      .object({
        result: dailyAnalysisCheckResultSchema,
        details: z.string().min(1)
      })
      .strict(),
    logicConsistencyCheck: z
      .object({
        result: dailyAnalysisCheckResultSchema,
        details: z.string().min(1)
      })
      .strict(),
    reasoning: z.array(z.string().min(1)).min(1),
    finalAction: z.string().min(1)
  })
  .strict();

export type DailyAnalysisAnalystDraft = z.infer<typeof dailyAnalysisAnalystDraftSchema>;
