import type { IndicatorSnapshot } from '../types/analysis';

export function buildAnalysisPrompt(input: {
  symbol: string;
  timeframe: string;
  indicators: IndicatorSnapshot;
}) {
  return {
    system:
      'You are a market analysis assistant. Respond in Vietnamese. Use only the supplied market data. Do not invent news. Return concise structured JSON.',
    user: JSON.stringify(input)
  };
}
