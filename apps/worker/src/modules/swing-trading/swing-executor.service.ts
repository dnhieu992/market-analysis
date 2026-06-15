import { Injectable, Logger } from '@nestjs/common';
import { createSwingTradingRepository } from '@app/db';

type SwingSignal = Awaited<
  ReturnType<ReturnType<typeof createSwingTradingRepository>['findLatestSignal']>
>;

export type OpenParams = {
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLevel: number;
  keyValue: number;
  atrPeriod: number;
  riskPerTrade: number; // margin/position budget in USD
  leverage: number;
  mode: string; // 'PAPER' | 'LIVE'
  atr: number;
};

/**
 * Execution seam for swing trading (UTBot stop-and-reverse).
 *
 * PHASE 1 (current) — PAPER mode: persist the position; no broker order.
 * PHASE 2 (future) — LIVE mode: place the real Bitget order here (authenticated
 *   REST), then store the broker order id. The detection/flip logic above stays
 *   unchanged, so flipping to live is a localized change.
 */
@Injectable()
export class SwingExecutorService {
  private readonly logger = new Logger(SwingExecutorService.name);
  private readonly repo = createSwingTradingRepository();

  /** Open a new position in the trend direction. */
  async openPosition(p: OpenParams): Promise<void> {
    const positionValue = p.riskPerTrade * p.leverage;
    const quantity = p.entryPrice > 0 ? positionValue / p.entryPrice : 0;

    this.logger.log(
      `🔔 SWING [${p.mode}] OPEN ${p.direction} ${p.symbol} ${p.timeframe} | ` +
        `Entry ${p.entryPrice} | UTBot stop ${p.stopLevel.toFixed(2)} | kv=${p.keyValue} | ` +
        `Qty ${quantity.toFixed(6)} (~$${positionValue.toFixed(0)} @ ${p.leverage}x)`,
    );

    await this.repo.createSignal({
      symbol: p.symbol,
      timeframe: p.timeframe,
      setupType: 'UTBOT_FLIP',
      direction: p.direction,
      entryPrice: p.entryPrice,
      stopLoss: p.stopLevel,
      takeProfit: 0, // no fixed TP — exit is the trend flip
      rrRatio: 0,
      riskAmount: p.riskPerTrade,
      keyValue: p.keyValue,
      quantity,
      positionValue,
      status: 'ACTIVE',
      mode: p.mode,
      setupJson: JSON.stringify({
        strategy: 'UTBOT_FLIP',
        timeframe: p.timeframe,
        atrPeriod: p.atrPeriod,
        keyValue: p.keyValue,
        utbotStop: p.stopLevel,
        atr: p.atr,
      }),
      detectedAt: new Date(),
    });

    // PHASE 2 (future): if (p.mode === 'LIVE') place Bitget order + store order id.
  }

  /** Close an open position at the candle close (trend flipped). Gross P&L (fees excluded). */
  async closePosition(signal: NonNullable<SwingSignal>, exitPrice: number): Promise<number> {
    const priceMove = signal.direction === 'LONG' ? exitPrice - signal.entryPrice : signal.entryPrice - exitPrice;
    const qty = signal.quantity ?? 0;
    const pnlUsd = qty * priceMove;

    await this.repo.closeSignal(signal.id, {
      status: 'CLOSED',
      closedPrice: exitPrice,
      closedAt: new Date(),
      pnlUsd,
    });

    this.logger.log(
      `✋ SWING [${signal.mode}] CLOSE ${signal.direction} ${signal.symbol} @ ${exitPrice} → ` +
        `$${pnlUsd.toFixed(2)} (entry ${signal.entryPrice})`,
    );

    // PHASE 2 (future): if (signal.mode === 'LIVE') close the real Bitget order here.
    return pnlUsd;
  }

  /** Keep the stored stop in sync with the ratcheting UTBot line (display/monitoring). */
  async syncStop(id: string, stopLevel: number): Promise<void> {
    await this.repo.updateStopLoss(id, stopLevel);
  }
}
