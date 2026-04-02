import { LlmService } from '../src/modules/llm/llm.service';
import { OpenAiCompatibleClient } from '../src/modules/llm/openai-compatible.client';

describe('llm service', () => {
  const analysisInput = {
    symbol: 'BTCUSDT',
    timeframe: '4h',
    indicators: {
      price: {
        open: 67800,
        high: 68500,
        low: 67550,
        close: 68210
      },
      ema20: 68000,
      ema50: 67000,
      ema200: 62000,
      rsi14: 56,
      macd: { macd: 120, signal: 90, histogram: 30 },
      atr14: 800,
      volumeRatio: 1.3,
      supportLevels: [67200, 66500],
      resistanceLevels: [68800, 69500],
      lastCandles: [
        { open: 67000, high: 68100, low: 66800, close: 67900 },
        { open: 67900, high: 68500, low: 67550, close: 68210 }
      ]
    }
  };

  it('returns normalized validated structured output', async () => {
    const client = {
      createChatCompletion: jest.fn().mockResolvedValue(
        JSON.stringify({
          trend: 'uptrend',
          bias: 'bullish',
          confidence: 81.2,
          summary: '  Dong luc tang van duoc giu vung. ',
          supportLevels: [67200, 66500],
          resistanceLevels: [68800, 69500],
          invalidation: ' Dong cua duoi 66500 ',
          bullishScenario: ' Tiep tuc giu tren 68800 ',
          bearishScenario: ' Bi tu choi manh o 69500 '
        })
      )
    } as unknown as jest.Mocked<OpenAiCompatibleClient>;

    const service = new LlmService(client);
    const signal = await service.analyzeMarket(analysisInput);

    expect(signal).toEqual({
      trend: 'uptrend',
      bias: 'bullish',
      confidence: 81,
      summary: 'Dong luc tang van duoc giu vung.',
      supportLevels: [67200, 66500],
      resistanceLevels: [68800, 69500],
      invalidation: 'Dong cua duoi 66500',
      bullishScenario: 'Tiep tuc giu tren 68800',
      bearishScenario: 'Bi tu choi manh o 69500'
    });
  });

  it('retries once when the first structured output is invalid', async () => {
    const client = {
      createChatCompletion: jest
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            trend: 'uptrend',
            bias: 'bullish',
            confidence: 120
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            trend: 'sideways',
            bias: 'neutral',
            confidence: 55,
            summary: 'Thi truong dang tich luy',
            supportLevels: [67000],
            resistanceLevels: [69000],
            invalidation: 'Mat 67000',
            bullishScenario: 'Vuot 69000',
            bearishScenario: 'Bi tu choi tai 69000'
          })
        )
    } as unknown as jest.Mocked<OpenAiCompatibleClient>;

    const service = new LlmService(client);
    const signal = await service.analyzeMarket(analysisInput);

    expect(signal.bias).toBe('neutral');
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('throws gracefully after retry exhaustion', async () => {
    const client = {
      createChatCompletion: jest
        .fn()
        .mockResolvedValue(JSON.stringify({ trend: 'uptrend', bias: 'bullish' }))
    } as unknown as jest.Mocked<OpenAiCompatibleClient>;

    const service = new LlmService(client);

    await expect(service.analyzeMarket(analysisInput)).rejects.toThrow(
      'Failed to generate valid LLM signal after 2 attempts'
    );
  });
});
