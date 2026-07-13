import { detectEmaStackOversoldEntry, DEFAULT_EMA_STACK_OVERSOLD_CONFIG } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

/**
 * "Extended-below-EMA-stack oversold StochRSI bounce" — LONG only, counter-trend.
 *
 * Entry (shared with the worker's 4h auto-scanner via `detectEmaStackOversoldEntry`):
 *   price below a bearish EMA34/89/200 stack, stretched 7–15% below EMA34, StochRSI %K
 *   crosses up %D while oversold. Take profit tpPct above entry, NO stop loss (held until
 *   TP or end-of-data mark-to-market).
 *
 * ⚠ Backtest note (2026-07-13, see claude-backtest/runs/): as specified (no SL) this rule
 * has ~80% TP-hit but NEGATIVE expectancy (−2.6%/trade) — rare falling-knife positions are
 * held indefinitely (avg MAE −20%). Adding an ~8% SL flips it positive.
 */
function numParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export class EmaStackOversoldStochRsiStrategy implements IBackTestStrategy {
  readonly name = 'ema-stack-oversold-stochrsi';
  readonly description =
    'LONG bounce: giá dưới cụm EMA34<89<200 và giãn 7–15% dưới EMA34, StochRSI %K cắt lên %D trong vùng quá bán; TP ~10%, KHÔNG cắt lỗ (giữ tới khi chạm TP). ⚠ Backtest expectancy âm khi không có SL. Params: tpPct (0.10), distMin (0.07), distMax (0.15), osLevel (20).';
  readonly defaultTimeframe = '4h';
  readonly disableBreakeven = true;

  evaluate(ctx: StrategyContext): TradeSignal | null {
    const closes = ctx.candles.map((c) => c.close);
    const cfg = {
      tpPct: numParam(ctx.params, 'tpPct', DEFAULT_EMA_STACK_OVERSOLD_CONFIG.tpPct),
      distMin: numParam(ctx.params, 'distMin', DEFAULT_EMA_STACK_OVERSOLD_CONFIG.distMin),
      distMax: numParam(ctx.params, 'distMax', DEFAULT_EMA_STACK_OVERSOLD_CONFIG.distMax),
      osLevel: numParam(ctx.params, 'osLevel', DEFAULT_EMA_STACK_OVERSOLD_CONFIG.osLevel),
    };

    const entry = detectEmaStackOversoldEntry(closes, cfg);
    if (!entry) return null;

    return {
      direction: 'long',
      entryPrice: entry.price,
      // No SL per the user's rule: 0 is never hit intra-candle for a long (low > 0),
      // so the trade is held until TP or end-of-data mark-to-market.
      stopLoss: 0,
      takeProfit: entry.tpPrice,
    };
  }
}

export default EmaStackOversoldStochRsiStrategy;
