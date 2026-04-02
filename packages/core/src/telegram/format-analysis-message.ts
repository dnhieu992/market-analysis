import type { LlmSignal } from '../types/signal';

export function formatAnalysisMessage(
  input: LlmSignal & {
    symbol: string;
    timeframe: string;
  }
) {
  const supportSection = input.supportLevels.map((value) => `- ${value}`).join('\n');
  const resistanceSection = input.resistanceLevels.map((value) => `- ${value}`).join('\n');

  return [
    `BTC/USDT`.replace('BTC/USDT', `${input.symbol} - Phan tich nen ${input.timeframe} vua dong`),
    '',
    `Xu huong: ${input.trend}`,
    `Thien huong: ${input.bias}`,
    `Do tin cay: ${input.confidence}%`,
    '',
    'Tom tat:',
    input.summary,
    '',
    'Ho tro:',
    supportSection,
    '',
    'Khang cu:',
    resistanceSection,
    '',
    'Kich ban chinh:',
    input.bullishScenario,
    '',
    'Kich ban nguoc:',
    input.bearishScenario,
    '',
    `Vo hieu: ${input.invalidation}`,
    '',
    'Luu y: Day la phan tich tu dong, khong phai khuyen nghi dau tu.'
  ].join('\n');
}
