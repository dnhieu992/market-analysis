import { z } from 'zod';

import {
  dailyAnalysisCheckResultSchema,
  dailyAnalysisBiasSchema,
  dailyAnalysisSetupTypeSchema,
  dailyAnalysisSetupSchema
} from './daily-analysis-plan.schema';

const dailyAnalysisValidatorCheckSchema = z
  .object({
    result: dailyAnalysisCheckResultSchema,
    details: z.string().min(1)
  })
  .strict();

const dailyAnalysisValidatorCorrectedPlanSchema = z
  .object({
    summary: z.string().min(1),
    bias: dailyAnalysisBiasSchema,
    confidence: z.number().int().min(0).max(100),
    status: z.enum(['TRADE_READY', 'WAIT', 'NO_TRADE']),
    setupType: dailyAnalysisSetupTypeSchema,
    primarySetup: dailyAnalysisSetupSchema,
    finalAction: z.string().min(1)
  })
  .strict();

export const dailyAnalysisValidatorResultSchema = z
  .object({
    validationResult: z.enum(['APPROVED', 'APPROVED_WITH_ADJUSTMENTS', 'REJECTED']),
    summary: z.string().min(1),
    majorIssues: z.array(z.string().min(1)),
    minorIssues: z.array(z.string().min(1)),
    checks: z
      .object({
        timeframeConsistency: dailyAnalysisValidatorCheckSchema,
        breakoutLogic: dailyAnalysisValidatorCheckSchema,
        riskReward: dailyAnalysisValidatorCheckSchema,
        atrConsistency: dailyAnalysisValidatorCheckSchema,
        volumeConfirmation: dailyAnalysisValidatorCheckSchema,
        narrativeVsAction: dailyAnalysisValidatorCheckSchema,
        structureQuality: dailyAnalysisValidatorCheckSchema
      })
      .strict(),
    correctedPlan: dailyAnalysisValidatorCorrectedPlanSchema,
    finalDecisionNote: z.string().min(1)
  })
  .strict();

export type DailyAnalysisValidatorResult = z.infer<typeof dailyAnalysisValidatorResultSchema>;
