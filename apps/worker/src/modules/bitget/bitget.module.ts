import { Module } from '@nestjs/common';

import { BitgetService } from './bitget.service';
import { BitgetTradeService } from './bitget-trade.service';
import { BitgetWebSocketService } from './bitget-websocket.service';

/**
 * Shared Bitget connect + action layer for the worker, kept for reuse by future
 * trading bots after the day-trading / long-signal bots were removed:
 *   - `BitgetService`         — public REST market data (klines / ticker)
 *   - `BitgetTradeService`    — authenticated v2 mix orders (place / close / leverage)
 *   - `BitgetWebSocketService`— public WS live prices (ticker / candle)
 *
 * Intentionally NOT imported by `WorkerModule` yet — nothing consumes it, so we
 * keep it out of the Nest graph to avoid opening an idle WS connection on boot.
 * A future bot module should import this module and inject the services it needs.
 * `retry.util.ts` (colocated) is the shared retry helper these services use.
 */
@Module({
  providers: [BitgetService, BitgetTradeService, BitgetWebSocketService],
  exports: [BitgetService, BitgetTradeService, BitgetWebSocketService],
})
export class BitgetModule {}
