import { z } from 'zod';

export const llmSignalSchema = z.object({
  trend: z.enum(['uptrend', 'downtrend', 'sideways']),
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number().min(0).max(100),
  summary: z.string().min(1),
  supportLevels: z.array(z.number()),
  resistanceLevels: z.array(z.number()),
  invalidation: z.string().min(1),
  bullishScenario: z.string().min(1),
  bearishScenario: z.string().min(1)
});
