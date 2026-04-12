import type { StrategyContext, TradeSignal } from '../types/back-test.types';

export interface IBackTestStrategy {
  readonly name: string;
  readonly description: string;
  readonly defaultTimeframe: string;
  /** If set, the engine always uses this timeframe and ignores the UI selection */
  readonly forcedTimeframe?: string;
  evaluate(ctx: StrategyContext): TradeSignal | null;
}
