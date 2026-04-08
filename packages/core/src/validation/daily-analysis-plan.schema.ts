import { z } from 'zod';

export const dailyAnalysisBiasSchema = z.enum(['Bullish', 'Bearish', 'Neutral']);

export const dailyAnalysisStatusSchema = z.enum(['TRADE_READY', 'WAIT', 'NO_TRADE']);
export const dailyAnalysisSetupTypeSchema = z.enum(['breakout', 'pullback', 'range', 'no-trade']);
export const dailyAnalysisSetupDirectionSchema = z.enum(['long', 'short', 'none']);
export const dailyAnalysisCheckResultSchema = z.enum(['PASS', 'FAIL', 'WARNING']);
export const dailyAnalysisTimeframeAlignmentSchema = z.enum(['aligned', 'conflicting', 'neutral']);
export const dailyAnalysisTrendConditionSchema = z.enum([
  'trending',
  'ranging',
  'compressed',
  'transitional'
]);
export const dailyAnalysisVolumeConditionSchema = z.enum(['strong', 'normal', 'weak', 'very_weak']);
export const dailyAnalysisVolatilityConditionSchema = z.enum(['high', 'normal', 'low']);

export const dailyAnalysisSetupSchema = z
  .object({
    direction: dailyAnalysisSetupDirectionSchema,
    trigger: z.string().min(1),
    entry: z.string().min(1),
    stopLoss: z.string().min(1),
    takeProfit1: z.string().min(1),
    takeProfit2: z.string().min(1),
    riskReward: z.string().min(1),
    invalidation: z.string().min(1)
  })
  .strict();

export const dailyAnalysisTimeframeContextSchema = z
  .object({
    biasFrame: z.literal('D1'),
    setupFrame: z.literal('H4'),
    entryRefinementFrame: z.literal('none'),
    higherTimeframeView: z.string().min(1),
    setupTimeframeView: z.string().min(1),
    alignment: dailyAnalysisTimeframeAlignmentSchema
  })
  .strict();

export const dailyAnalysisMarketStateSchema = z
  .object({
    trendCondition: dailyAnalysisTrendConditionSchema,
    volumeCondition: dailyAnalysisVolumeConditionSchema,
    volatilityCondition: dailyAnalysisVolatilityConditionSchema,
    keyObservation: z.string().min(1)
  })
  .strict();

export const dailyAnalysisConsistencyCheckSchema = z
  .object({
    result: dailyAnalysisCheckResultSchema,
    details: z.string().min(1)
  })
  .strict();

export const dailyAnalysisPlanCoreSchema = z
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
    finalAction: z.string().min(1),
    reasoning: z.array(z.string().min(1)).min(1),
    atrConsistencyCheck: dailyAnalysisConsistencyCheckSchema,
    logicConsistencyCheck: dailyAnalysisConsistencyCheckSchema
  })
  .strict();

export const dailyAnalysisPlanSchema = dailyAnalysisPlanCoreSchema.strict();

export type DailyAnalysisSetup = z.infer<typeof dailyAnalysisSetupSchema>;
export type DailyAnalysisPlanCore = z.infer<typeof dailyAnalysisPlanCoreSchema>;
export type DailyAnalysisPlan = z.infer<typeof dailyAnalysisPlanSchema>;
