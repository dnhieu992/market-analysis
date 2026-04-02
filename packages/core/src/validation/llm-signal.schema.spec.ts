import { normalizeLlmSignal } from '../normalizers/normalize-llm-signal';
import { llmSignalSchema } from './llm-signal.schema';

describe('llm signal schema', () => {
  it('validates and normalizes structured signal output', () => {
    const parsed = llmSignalSchema.parse({
      trend: 'uptrend',
      bias: 'bullish',
      confidence: 78,
      summary: '  Xu huong tang.  ',
      supportLevels: [67200, 66550],
      resistanceLevels: [68700, 69500],
      invalidation: 'Mat ho tro 66,550',
      bullishScenario: 'Giu tren 68,000',
      bearishScenario: 'Roi xuong duoi 66,550'
    });

    expect(normalizeLlmSignal(parsed)).toEqual({
      ...parsed,
      summary: 'Xu huong tang.'
    });
  });
});
