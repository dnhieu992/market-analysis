export type Trend = 'uptrend' | 'downtrend' | 'sideways';
export type Bias = 'bullish' | 'bearish' | 'neutral';

export type LlmSignal = {
  trend: Trend;
  bias: Bias;
  confidence: number;
  summary: string;
  supportLevels: number[];
  resistanceLevels: number[];
  invalidation: string;
  bullishScenario: string;
  bearishScenario: string;
};
