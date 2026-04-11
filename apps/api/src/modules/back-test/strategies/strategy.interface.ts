import type { StrategyContext, TradeSignal } from '../types/back-test.types';

export interface IBackTestStrategy {
  readonly name: string;
  readonly description: string;
  readonly defaultTimeframe: string;
  evaluate(ctx: StrategyContext): TradeSignal | null;
}
