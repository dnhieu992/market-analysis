import { Injectable, Logger } from '@nestjs/common';
import { createDayTradingRepository } from '@app/db';
import { BitgetService } from './bitget.service';
import { BitgetWebSocketService } from './bitget-websocket.service';

@Injectable()
export class ResultMonitorService {
  private readonly logger = new Logger(ResultMonitorService.name);
  private readonly repo = createDayTradingRepository();

  constructor(
    private readonly bitget: BitgetService,
    private readonly ws: BitgetWebSocketService,
  ) {}

  async checkActiveSignals(): Promise<void> {
    const active = await this.repo.findActiveSignals('BTCUSDT');
    if (!active.length) return;

    // Prefer the real-time WS price; fall back to REST if the feed is stale.
    let price = this.ws.isHealthy() ? this.ws.getLatestPrice() : null;
    if (price == null) {
      price = await this.bitget.fetchCurrentPrice();
    }
    if (!price) {
      this.logger.warn('Could not obtain price for result monitoring');
      return;
    }

    for (const signal of active) {
      const { id, direction, entryPrice, takeProfit, stopLoss } = signal;
      let hit: 'TP_HIT' | 'SL_HIT' | null = null;

      if (direction === 'LONG') {
        if (price >= takeProfit) hit = 'TP_HIT';
        else if (price <= stopLoss) hit = 'SL_HIT';
      } else {
        if (price <= takeProfit) hit = 'TP_HIT';
        else if (price >= stopLoss) hit = 'SL_HIT';
      }

      if (hit) {
        // Realized P&L in USD = volume × price move (signed by direction).
        // Falls back to the fixed ±risk model if volume wasn't stored.
        const qty = signal.quantity;
        const priceMove = direction === 'LONG' ? price - entryPrice : entryPrice - price;
        const pnlUsd = qty != null
          ? qty * priceMove
          : (hit === 'TP_HIT' ? signal.rrRatio * signal.riskAmount : -signal.riskAmount);

        await this.repo.updateSignalResult(id, {
          status: hit,
          closedPrice: price,
          closedAt: new Date(),
          pnlUsd,
        });
        this.logger.log(
          `Signal ${id} closed: ${hit} @ ${price} → $${pnlUsd.toFixed(2)} (entry ${entryPrice}, SL ${stopLoss}, TP ${takeProfit})`,
        );
      }
    }
  }
}
