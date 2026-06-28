import { Injectable, Logger } from '@nestjs/common';
import { createDcaLadderRepository } from '@app/db';
import { tierPrices, computeTimeframeTrend, effectiveFirstTierPct } from '@app/core';
import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TelegramService } from '../telegram/telegram.service';

const SYMBOL = 'BTCUSDT';

@Injectable()
export class DcaLadderSyncService {
  private readonly logger = new Logger(DcaLadderSyncService.name);
  private repo = createDcaLadderRepository();

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * First tier % for a FLAT cycle: shallow (firstTierPct) in a weekly uptrend, deep
   * (bearFirstTierPct) in a bear/neutral week. Non-fatal: falls back to the bull value
   * if the weekly klines can't be fetched.
   */
  private async resolveFirstTierPct(settings: any): Promise<number> {
    try {
      const wk = await this.binance.fetchKlines({ symbol: SYMBOL, timeframe: '1w', limit: 300 });
      const trend = computeTimeframeTrend(
        wk.map((k) => parseFloat(k[4] as string)),
        wk.map((k) => parseFloat(k[2] as string)),
        wk.map((k) => parseFloat(k[3] as string)),
      );
      return effectiveFirstTierPct(trend, settings.firstTierPct, settings.bearFirstTierPct);
    } catch (e) {
      this.logger.warn(`week trend failed, using bull first tier: ${e instanceof Error ? e.message : String(e)}`);
      return settings.firstTierPct;
    }
  }

  async syncDaily() {
    const empty = { touchedTiers: [] as number[], tpReady: false, changed: false };
    const settings = await this.repo.getSettings();
    if (!settings.enabled) return empty;

    const cycle = await this.repo.getCurrentCycle(SYMBOL);
    if (!cycle) return empty;

    const klines = await this.binance.fetchKlines({ symbol: SYMBOL, timeframe: '1d', limit: 2 });
    if (klines.length < 2) return empty;
    const closedRaw = klines[klines.length - 2] ?? klines[klines.length - 1];
    if (!closedRaw) return empty;
    const high = parseFloat(closedRaw[2] as string);
    const low = parseFloat(closedRaw[3] as string);

    const orders = await this.repo.getOrdersByCycle(cycle.id);
    // Snapshot original planned prices before any peak re-arming mutates them.
    // PENDING_FILL is checked against the prices that were in effect at candle open,
    // not the newly recalculated ones (which take effect from the next candle).
    const originalPrices = new Map<string, number>(
      orders.map((o: any) => [o.id, o.plannedPrice as number])
    );
    const touchedTiers: number[] = [];
    let tpReady = false;

    if (cycle.status === 'FLAT') {
      const newPeak = Math.max(cycle.peak, high);
      if (newPeak !== cycle.peak) await this.repo.updateCycle(cycle.id, { peak: newPeak });
      // Weekly-adaptive first tier: re-arm tier prices every FLAT day so a peak rise OR a
      // weekly trend flip (bull↔bear) is reflected. New prices take effect next candle
      // (PENDING_FILL below still checks the snapshot prices that were in effect at open).
      const firstTierPct = await this.resolveFirstTierPct(settings);
      const prices = tierPrices(newPeak, {
        firstTierPct, numTiers: settings.numTiers, stepPct: settings.stepPct,
      });
      for (const o of orders) {
        if (o.side === 'BUY' && o.status === 'ARMED' && o.tierIndex != null) {
          const newPrice = prices[o.tierIndex];
          if (newPrice == null) continue;
          await this.repo.updateOrder(o.id, { plannedPrice: newPrice });
        }
      }
    }

    for (const o of orders) {
      const checkPrice = originalPrices.get(o.id) ?? o.plannedPrice;
      if (o.side === 'BUY' && o.status === 'ARMED' && o.tierIndex != null && low <= checkPrice) {
        await this.repo.updateOrder(o.id, { status: 'PENDING_FILL' });
        touchedTiers.push(o.tierIndex);
      }
    }

    if (cycle.status === 'IN_POSITION' && cycle.tpPrice != null && high >= cycle.tpPrice) {
      const sell = orders.find((o: any) => o.side === 'SELL' && o.status === 'ARMED');
      if (sell) {
        await this.repo.updateOrder(sell.id, { status: 'PENDING_FILL' });
        tpReady = true;
      }
    }

    const changed = touchedTiers.length > 0 || tpReady;
    if (changed) {
      const lines = ['🪜 <b>DCA Ladder — BTC</b>'];
      if (touchedTiers.length) lines.push(`Tier chạm giá: ${touchedTiers.sort((a, b) => a - b).map((t) => `#${t + 1}`).join(', ')} → vào lệnh mua tay.`);
      if (tpReady) lines.push(`✅ TP sẵn sàng (giá ≥ ${cycle.tpPrice?.toFixed(2)}) → chốt 100%.`);
      try {
        await this.telegram.sendToChat(process.env.TELEGRAM_CHAT_ID ?? '', lines.join('\n'));
      } catch (e) {
        this.logger.warn(`Telegram send failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { touchedTiers, tpReady, changed };
  }
}
