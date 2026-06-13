import { Injectable, Logger } from '@nestjs/common';
import { createDayTradingRepository } from '@app/db';
import type { SetupResult } from './setup-analyzer.service';

/**
 * The execution seam between PHASE 1 and PHASE 2.
 *
 * PHASE 1 (current) — PAPER mode: print the LONG/SHORT signal and persist it
 *   for strategy review. No order is placed; no account is needed.
 *
 * PHASE 2 (future) — LIVE mode: when a real Bitget account is connected, place
 *   the actual order here (authenticated REST/WS) and store the broker order id.
 *   The detection pipeline above this service stays unchanged.
 */
@Injectable()
export class SignalExecutorService {
  private readonly logger = new Logger(SignalExecutorService.name);
  private readonly repo = createDayTradingRepository();

  async execute(symbol: string, setup: SetupResult): Promise<void> {
    // PHASE 1: print the signal — no order placement.
    this.logger.log(
      `🔔 TÍN HIỆU [PAPER] ${setup.direction} ${symbol} | ${setup.setupType} | ` +
        `Entry ${setup.entryPrice} | SL ${setup.stopLoss} | TP ${setup.takeProfit} | R:R 1:${setup.rrRatio}`,
    );

    await this.repo.createSignal({
      symbol,
      setupType: setup.setupType,
      direction: setup.direction,
      entryPrice: setup.entryPrice,
      stopLoss: setup.stopLoss,
      takeProfit: setup.takeProfit,
      rrRatio: setup.rrRatio,
      riskAmount: setup.riskAmount,
      status: 'ACTIVE',
      mode: 'PAPER',
      setupJson: setup.setupJson,
      detectedAt: new Date(),
    });

    // PHASE 2 (future):
    //   if (this.liveTradingEnabled) {
    //     const order = await this.bitgetTradeService.placeOrder({ ... });
    //     await this.repo.attachBrokerOrder(signalId, order.orderId);
    //   }
  }
}
