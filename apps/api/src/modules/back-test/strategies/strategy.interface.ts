import type { StrategyContext, TradeSignal } from '../types/back-test.types';

export interface IBackTestStrategy {
  readonly name: string;
  readonly description: string;
  readonly defaultTimeframe: string;
  /** If set, the engine always uses this timeframe and ignores the UI selection */
  readonly forcedTimeframe?: string;
  /** Additional HTF timeframes to fetch and expose in ctx.htfCandles (merged with the default ['4h','1h'] list) */
  readonly htfTimeframes?: string[];
  /** If true, the engine skips the breakeven SL move for this strategy */
  readonly disableBreakeven?: boolean;
  evaluate(ctx: StrategyContext): TradeSignal | null;
}
