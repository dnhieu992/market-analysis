import { Injectable, Logger } from '@nestjs/common';
import { createSwingTradingRepository } from '@app/db';

type SwingSignal = Awaited<
  ReturnType<ReturnType<typeof createSwingTradingRepository>['findLatestSignal']>
>;

/** Favorable move from entry that triggers the partial take-profit + breakeven ratchet. */
export const PARTIAL_TP_PCT = 0.05; // +5%
/** Fraction of the leg closed at the partial take-profit (the rest rides the UTBot trail). */
export const PARTIAL_FRACTION = 0.5; // close half

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

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

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
  legKind?: 'BASE' | 'ADD'; // 'ADD' = pullback scale-in toward the UTBot line
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

  /** Open a new position in the trend direction (base entry or a pullback scale-in). */
  async openPosition(p: OpenParams): Promise<void> {
    const legKind = p.legKind ?? 'BASE';
    const isAdd = legKind === 'ADD';
    const positionValue = p.riskPerTrade * p.leverage;
    const quantity = p.entryPrice > 0 ? positionValue / p.entryPrice : 0;

    this.logger.log(
      `🔔 SWING [${p.mode}] OPEN ${isAdd ? 'ADD' : 'BASE'} ${p.direction} ${p.symbol} ${p.timeframe} | ` +
        `Entry ${p.entryPrice} | UTBot stop ${p.stopLevel.toFixed(2)} | kv=${p.keyValue} | ` +
        `Qty ${quantity.toFixed(6)} (~$${positionValue.toFixed(0)} @ ${p.leverage}x)` +
        (isAdd ? ' | pullback scale-in' : ''),
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
      legKind,
      // a fresh BASE leg starts un-armed; an ADD leg never carries arm state itself
      pullbackArmed: false,
      // Auto-journal: first line records the entry.
      note: `- ▶️ ${noteTs()} — Vào ${p.direction}${isAdd ? ' (nhồi pullback)' : ''} @ ${fmtNum(p.entryPrice)} · SL UTBot ${fmtNum(p.stopLevel)}`,
      setupJson: JSON.stringify({
        strategy: 'UTBOT_FLIP',
        legKind,
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

  /**
   * Take a partial profit once price has run +PARTIAL_TP_PCT from entry: close
   * PARTIAL_FRACTION of the leg, bank the realized P&L, keep the remainder open and
   * ratchet its stop to breakeven (entry). The remaining half then rides the UTBot trail.
   */
  async takePartialProfit(leg: NonNullable<SwingSignal>, exitPrice: number): Promise<number> {
    const qty = leg.quantity ?? 0;
    const closedQty = qty * PARTIAL_FRACTION;
    const remainingQty = qty - closedQty;
    const priceMove = leg.direction === 'LONG' ? exitPrice - leg.entryPrice : leg.entryPrice - exitPrice;
    const realized = closedQty * priceMove;
    const bankedTotal = (leg.realizedPnlUsd ?? 0) + realized;

    await this.repo.applyPartialTake(leg.id, {
      quantity: remainingQty,
      realizedPnlUsd: bankedTotal,
      stopLoss: leg.entryPrice, // SL → breakeven
    });

    await this.appendNote(
      leg.id,
      `- 🎯 ${noteTs()} — Chốt 1/2 @ ${fmtNum(exitPrice)} (+$${realized.toFixed(2)}) · kéo SL về entry ${fmtNum(leg.entryPrice)}`,
    );

    this.logger.log(
      `🎯 SWING [${leg.mode}] PARTIAL ${leg.direction} ${leg.symbol} @ ${exitPrice} → ` +
        `+$${realized.toFixed(2)} (closed ${(PARTIAL_FRACTION * 100).toFixed(0)}% = ${closedQty.toFixed(6)}, ` +
        `remaining ${remainingQty.toFixed(6)}) | SL → breakeven ${leg.entryPrice}`,
    );

    // PHASE 2 (future): if (leg.mode === 'LIVE') reduce the Bitget position by half + move SL to entry.
    return realized;
  }

  /**
   * Close an open position at the candle close. Gross P&L (fees excluded).
   * `reason` annotates the auto-journal: 'flip' (trend reversed) | 'breakeven' (runner back to entry).
   */
  async closePosition(
    signal: NonNullable<SwingSignal>,
    exitPrice: number,
    reason: 'flip' | 'breakeven' = 'flip',
  ): Promise<number> {
    const priceMove = signal.direction === 'LONG' ? exitPrice - signal.entryPrice : signal.entryPrice - exitPrice;
    const qty = signal.quantity ?? 0;
    // Add any P&L already banked from an earlier partial close.
    const pnlUsd = (signal.realizedPnlUsd ?? 0) + qty * priceMove;

    await this.repo.closeSignal(signal.id, {
      status: 'CLOSED',
      closedPrice: exitPrice,
      closedAt: new Date(),
      pnlUsd,
    });

    const note = reason === 'breakeven'
      ? `- 🟰 ${noteTs()} — Đóng nốt phần còn lại @ ${fmtNum(exitPrice)} · hòa vốn · P&L tổng $${pnlUsd.toFixed(2)}`
      : `- ✋ ${noteTs()} — Đóng @ ${fmtNum(exitPrice)} (đảo trend) · P&L $${pnlUsd.toFixed(2)}`;
    await this.appendNote(signal.id, note);

    this.logger.log(
      `✋ SWING [${signal.mode}] CLOSE ${signal.direction} ${signal.symbol} @ ${exitPrice} → ` +
        `$${pnlUsd.toFixed(2)} (entry ${signal.entryPrice}${signal.partialClosed ? ', after partial' : ''})`,
    );

    // PHASE 2 (future): if (signal.mode === 'LIVE') close the real Bitget order here.
    return pnlUsd;
  }

  /** Keep the stored stop in sync with the ratcheting UTBot line (display/monitoring). */
  async syncStop(id: string, stopLevel: number): Promise<void> {
    await this.repo.updateStopLoss(id, stopLevel);
  }

  /** Append a line to the signal's markdown note — never throws (journaling is best-effort). */
  private async appendNote(id: string, line: string): Promise<void> {
    try {
      await this.repo.appendNote(id, line);
    } catch (err) {
      this.logger.warn(`Failed to append swing note for ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
