import { Injectable, Logger } from '@nestjs/common';
import { createLongSignalRepository } from '@app/db';
import { LongSignalTradeService, BitgetApiError } from './long-signal-trade.service';

const LIVE_ENABLED = () => process.env.LIVE_TRADING_ENABLED === 'true';

/** Timestamp label (Vietnam time) for auto-journal note lines, e.g. "14:30 18/06". */
function noteTs(): string {
  return new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hour12: false,
  });
}
const fmtNum = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 6 });

export type OpenLongParams = {
  symbol: string;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number; // catastrophe SL
  notional: number; // USD
  leverage: number;
  keyValue: number;
  atr: number;
  lineDistancePct?: number;
  mode: string; // 'PAPER' | 'LIVE'
};

/**
 * Execution seam for the Long Signal bot. PAPER persists the position only; LIVE
 * (LIVE_TRADING_ENABLED=true + credentials) also places the real Bitget LONG with
 * preset TP/SL. The detection logic in the orchestrator is unchanged across modes.
 */
@Injectable()
export class LongSignalExecutorService {
  private readonly logger = new Logger(LongSignalExecutorService.name);
  private readonly repo = createLongSignalRepository();

  constructor(private readonly trade: LongSignalTradeService) {}

  /** Open a LONG for one symbol (PAPER persist, or LIVE order + persist). */
  async openLong(p: OpenLongParams): Promise<void> {
    const live = LIVE_ENABLED() && this.trade.isConfigured() && p.mode === 'LIVE';
    if (LIVE_ENABLED() && p.mode === 'LIVE' && !this.trade.isConfigured()) {
      this.logger.error('LIVE requested but Bitget credentials missing — falling back to PAPER.');
    }
    const quantity = p.entryPrice > 0 ? p.notional / p.entryPrice : 0;

    const base = {
      symbol: p.symbol,
      direction: 'LONG',
      entryPrice: p.entryPrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      keyValue: p.keyValue,
      entryLineDistancePct: p.lineDistancePct,
      quantity,
      positionValue: p.notional,
      status: 'ACTIVE',
      note: `- ▶️ ${noteTs()} — Vào LONG @ ${fmtNum(p.entryPrice)} · TP ${fmtNum(p.takeProfit)} · SL bảo hiểm ${fmtNum(p.stopLoss)}` +
        (p.lineDistancePct != null ? ` · cách đường M30 ${p.lineDistancePct.toFixed(2)}%` : ''),
      setupJson: JSON.stringify({
        strategy: 'LONG_FOMO_M30_UTBOT',
        keyValue: p.keyValue,
        utbotStop: p.stopLoss,
        atr: p.atr,
        notional: p.notional,
        leverage: p.leverage,
      }),
      detectedAt: new Date(),
    };

    if (!live) {
      await this.repo.createSignal({ ...base, mode: 'PAPER' });
      this.logger.log(`🔔 LONG [PAPER] ${p.symbol} Entry ${p.entryPrice} TP ${p.takeProfit} Qty ${quantity.toFixed(6)} (~$${p.notional})`);
      return;
    }

    // LIVE: persist ACTIVE first (id = clientOid for idempotency), then place the order.
    const signal = await this.repo.createSignal({ ...base, mode: 'LIVE' });
    try {
      await this.trade.setLeverage(p.symbol, p.leverage);
      const order = await this.trade.placeLong({
        symbol: p.symbol,
        size: quantity,
        takeProfit: p.takeProfit,
        stopLoss: p.stopLoss,
        clientOid: signal.id,
      });
      await this.repo.attachBrokerOrder(signal.id, order.orderId);
      this.logger.log(`🔔 LONG [LIVE] ${p.symbol} Entry ${p.entryPrice} TP ${p.takeProfit} order ${order.orderId}`);
    } catch (err) {
      await this.repo.markSignalFailed(signal.id).catch(() => undefined);
      const code = err instanceof BitgetApiError ? err.code : 'n/a';
      this.logger.error(`LIVE LONG failed for ${p.symbol} (signal ${signal.id}) [code ${code}]: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
