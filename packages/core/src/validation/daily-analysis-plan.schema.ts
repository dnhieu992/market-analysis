import { z } from 'zod';

export const dailyAnalysisPlanSchema = z.object({
  analysis: z.string().min(1),
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number().int().min(0).max(100),
  tradePlan: z.object({
    entryZone: z.string().min(1),
    stopLoss: z.string().min(1),
    takeProfit: z.string().min(1),
    invalidation: z.string().min(1)
  }),
  scenarios: z.object({
    bullishScenario: z.string().min(1),
    bearishScenario: z.string().min(1)
  }),
  riskNote: z.string().min(1),
  timeHorizon: z.string().min(1)
});

export type DailyAnalysisPlan = z.infer<typeof dailyAnalysisPlanSchema>;
