import type { LlmSignal } from '../types/signal';

export function normalizeLlmSignal(signal: LlmSignal): LlmSignal {
  return {
    ...signal,
    confidence: Math.max(0, Math.min(100, Math.round(signal.confidence))),
    summary: signal.summary.trim(),
    invalidation: signal.invalidation.trim(),
    bullishScenario: signal.bullishScenario.trim(),
    bearishScenario: signal.bearishScenario.trim()
  };
}
