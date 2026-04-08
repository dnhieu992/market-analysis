import { z } from 'zod';

const dailyAnalysisCandleSchema = z
  .object({
    time: z.string().min(1),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number()
  })
  .strict();

const dailyAnalysisLevelPackSchema = z
  .object({
    support: z.array(z.number()).min(1),
    resistance: z.array(z.number()).min(1)
  })
  .strict();

const dailyAnalysisMacdSchema = z
  .object({
    line: z.number(),
    signal: z.number(),
    histogram: z.number()
  })
  .strict();

const dailyAnalysisTimeframeSchema = z
  .object({
    trend: z.enum(['bullish', 'bearish', 'neutral']),
    ohlcv: z.array(dailyAnalysisCandleSchema).min(100),
    ema20: z.number(),
    ema50: z.number(),
    ema200: z.number(),
    rsi14: z.number(),
    macd: dailyAnalysisMacdSchema,
    atr14: z.number(),
    volumeRatio: z.number(),
    levels: dailyAnalysisLevelPackSchema,
    swingHigh: z.number(),
    swingLow: z.number(),
    breakoutLevel: z.number().optional(),
    retestZone: z.tuple([z.number(), z.number()]).optional()
  })
  .strict();

const dailyAnalysisMarketFlagsSchema = z
  .object({
    majorNewsNearby: z.boolean(),
    liquidityCondition: z.enum(['normal', 'tight', 'thin']),
    marketRegime: z.enum(['trending', 'compressed', 'ranging', 'volatile'])
  })
  .strict();

export const dailyAnalysisMarketDataSchema = z
  .object({
    symbol: z.string().min(1),
    exchange: z.string().min(1),
    timestamp: z.string().min(1),
    currentPrice: z.number(),
    session: z.string().min(1),
    strategyProfile: z
      .object({
        biasFrame: z.literal('D1'),
        setupFrame: z.literal('H4'),
        entryRefinementFrame: z.literal('none'),
        strategyType: z.literal('breakout_following'),
        allowNoTrade: z.boolean(),
        minimumRr: z.number(),
        preferredBreakoutRr: z.number(),
        avoidScalpingLogic: z.boolean()
      })
      .strict(),
    timeframes: z
      .object({
        D1: dailyAnalysisTimeframeSchema,
        H4: dailyAnalysisTimeframeSchema
      })
      .strict(),
    marketFlags: dailyAnalysisMarketFlagsSchema.optional()
  })
  .strict();

export type DailyAnalysisMarketData = z.infer<typeof dailyAnalysisMarketDataSchema>;
