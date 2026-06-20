import { Injectable, Logger } from '@nestjs/common';
import { createDayTradingRepository } from '@app/db';
import type { SetupResult } from './setup-analyzer.service';
import { BitgetTradeService, BitgetApiError } from './bitget-trade.service';
import { audit } from './audit.util';

/**
 * The execution seam between PAPER and LIVE.
 *
 * PAPER mode: print the LONG/SHORT signal and persist it for strategy review.
 *   No order is placed; no account is needed.
 *
 * LIVE mode (LIVE_TRADING_ENABLED=true + credentials present): place a real
 *   Bitget order with preset TP/SL attached and store the broker order id. The
 *   detection pipeline above this service is unchanged.
 *
 * ⚠️ Before flipping LIVE_TRADING_ENABLED in production, the remaining
 * "REQUIRED before LIVE" items in docs/features/day-trading/day-trading.md must
 * also be in place — the LIVE result-monitor (reconcile broker fills instead of
 * closing on a WS tick) and the startup/periodic reconciliation job. This seam
 * places the order; it does not yet change how the monitor exits a LIVE trade.
 */
@Injectable()
export class SignalExecutorService {
  private readonly logger = new Logger(SignalExecutorService.name);
  private readonly repo = createDayTradingRepository();
  private readonly liveEnabled = process.env.LIVE_TRADING_ENABLED === 'true';

  constructor(private readonly trade: BitgetTradeService) {}

  async execute(symbol: string, setup: SetupResult): Promise<void> {
    if (this.liveEnabled && this.trade.isConfigured()) {
      await this.executeLive(symbol, setup);
      return;
    }
    if (this.liveEnabled && !this.trade.isConfigured()) {
      // Misconfiguration guard: the flag is on but keys are missing. Fall back to
      // PAPER rather than silently dropping the signal, and make the reason loud.
      this.logger.error(
        'LIVE_TRADING_ENABLED=true but Bitget credentials are missing — falling back to PAPER.',
      );
    }
    await this.executePaper(symbol, setup);
  }

  /** PAPER: print the signal and persist it. No order placement. */
  private async executePaper(symbol: string, setup: SetupResult): Promise<void> {
    this.logger.log(
      `🔔 TÍN HIỆU [PAPER] ${setup.direction} ${symbol} | ${setup.setupType} | ` +
        `Entry ${setup.entryPrice} | SL ${setup.stopLoss} | TP ${setup.takeProfit} | R:R 1:${setup.rrRatio} | ` +
        `Vol ${setup.quantity.toFixed(6)} BTC (~$${setup.positionValue.toFixed(0)}) | Risk $${setup.riskAmount}`,
    );

    const signal = await this.repo.createSignal({
      ...this.signalData(symbol, setup),
      mode: 'PAPER',
    });

    audit(this.repo, this.logger, {
      action: 'ORDER_PLACED',
      signalId: signal.id,
      symbol,
      message: `[PAPER] ${setup.direction} ${setup.setupType} entry ${setup.entryPrice} SL ${setup.stopLoss} TP ${setup.takeProfit}`,
      detail: { mode: 'PAPER', ...this.auditDetail(setup) },
    });
  }

  /**
   * LIVE: persist first (the signal id is the broker `clientOid`, which gives
   * exchange-side idempotency), then set leverage and place the real order with
   * preset TP/SL. On failure the signal is marked FAILED so no phantom ACTIVE row
   * lingers, and the error is captured in an ORDER_FAILED audit row (with the
   * Bitget code when present) for later tracing. Non-fatal — never throws back
   * into the scan loop.
   */
  private async executeLive(symbol: string, setup: SetupResult): Promise<void> {
    const holdSide = setup.direction === 'LONG' ? 'long' : 'short';

    // Create ACTIVE+LIVE first so we have a stable id to use as clientOid.
    const signal = await this.repo.createSignal({
      ...this.signalData(symbol, setup),
      mode: 'LIVE',
    });

    try {
      await this.trade.setLeverage(symbol, holdSide);
      const order = await this.trade.placeOrder({
        symbol,
        direction: setup.direction,
        size: setup.quantity,
        takeProfit: setup.takeProfit,
        stopLoss: setup.stopLoss,
        clientOid: signal.id,
      });
      await this.repo.attachBrokerOrder(signal.id, order.orderId);

      this.logger.log(
        `🔔 TÍN HIỆU [LIVE] ${setup.direction} ${symbol} | ${setup.setupType} | ` +
          `Entry ${setup.entryPrice} | SL ${setup.stopLoss} | TP ${setup.takeProfit} | ` +
          `Vol ${setup.quantity.toFixed(6)} BTC | order ${order.orderId}`,
      );
      audit(this.repo, this.logger, {
        action: 'ORDER_PLACED',
        signalId: signal.id,
        symbol,
        message: `[LIVE] ${setup.direction} ${setup.setupType} entry ${setup.entryPrice} SL ${setup.stopLoss} TP ${setup.takeProfit} order ${order.orderId}`,
        detail: { mode: 'LIVE', brokerOrderId: order.orderId, ...this.auditDetail(setup) },
      });
    } catch (err) {
      await this.repo.markSignalFailed(signal.id).catch((e) =>
        this.logger.error(`markSignalFailed(${signal.id}) failed: ${e instanceof Error ? e.message : String(e)}`),
      );
      const code = err instanceof BitgetApiError ? err.code : 'n/a';
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`LIVE order failed for ${symbol} (signal ${signal.id}) [code ${code}]: ${msg}`);
      audit(this.repo, this.logger, {
        action: 'ORDER_FAILED',
        signalId: signal.id,
        symbol,
        message: `[LIVE] order failed: ${msg}`,
        detail: { mode: 'LIVE', code, error: msg, ...this.auditDetail(setup) },
      });
    }
  }

  private signalData(symbol: string, setup: SetupResult) {
    return {
      symbol,
      setupType: setup.setupType,
      direction: setup.direction,
      entryPrice: setup.entryPrice,
      stopLoss: setup.stopLoss,
      takeProfit: setup.takeProfit,
      rrRatio: setup.rrRatio,
      riskAmount: setup.riskAmount,
      quantity: setup.quantity,
      positionValue: setup.positionValue,
      status: 'ACTIVE',
      setupJson: setup.setupJson,
      detectedAt: new Date(),
    };
  }

  private auditDetail(setup: SetupResult) {
    return {
      direction: setup.direction,
      setupType: setup.setupType,
      entryPrice: setup.entryPrice,
      stopLoss: setup.stopLoss,
      takeProfit: setup.takeProfit,
      rrRatio: setup.rrRatio,
      quantity: setup.quantity,
      riskAmount: setup.riskAmount,
    };
  }
}
