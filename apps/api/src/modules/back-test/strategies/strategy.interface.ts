import type { StrategyContext, TradeSignal } from '../types/back-test.types';

export interface IBackTestStrategy {
  readonly name: string;
  readonly description: string;
  readonly defaultTimeframe: string;
  /** If set, the engine always uses this timeframe and ignores the UI selection */
  readonly forcedTimeframe?: string;
  /** If true, the engine skips the breakeven SL move for this strategy */
  readonly disableBreakeven?: boolean;
  evaluate(ctx: StrategyContext): TradeSignal | null;
}
