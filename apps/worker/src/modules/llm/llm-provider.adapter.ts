import type { DailyAnalysisPlan } from '@app/core';

export type LlmProviderName = 'claude' | 'openai' | 'gemini';
export type ClaudeModelVariant = 'sonnet' | 'opus' | string;
export type DailyAnalysisTrend = 'bullish' | 'bearish' | 'neutral';

export type DailyAnalysisTimeframeInput = {
  trend: DailyAnalysisTrend;
  s1: number;
  s2: number;
  r1: number;
  r2: number;
};

export type DailyAnalysisGatewayInput = {
  symbol: string;
  date: Date;
  d1: DailyAnalysisTimeframeInput;
  h4: DailyAnalysisTimeframeInput;
  h4Indicators: {
    ema20: number;
    ema50: number;
    ema200: number;
    rsi14: number;
    macd: {
      macd: number;
      signal: number;
      histogram: number;
    };
    atr14: number;
    volumeRatio: number;
  };
};

export type DailyAnalysisGatewayResult = {
  provider: LlmProviderName;
  model: string;
  plan: DailyAnalysisPlan;
};

export interface LlmProviderAdapter {
  generateDailyAnalysisPlan(input: DailyAnalysisGatewayInput): Promise<DailyAnalysisGatewayResult>;
}
