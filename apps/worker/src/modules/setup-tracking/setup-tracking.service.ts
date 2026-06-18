import { Injectable, Logger } from '@nestjs/common';
import type { Candle } from '@app/core';
import { createTrackedSetupRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';

type TrackedSetupRepository = ReturnType<typeof createTrackedSetupRepository>;
type TrackedSetupRow = Awaited<ReturnType<TrackedSetupRepository['listOpen']>>[number];

// A PENDING setup that never fills within this many days is auto-expired.
const EXPIRY_DAYS = 3;
// Number of 1h candles fetched per symbol for the hourly tracking pass.
const TRACK_CANDLE_LIMIT = 48;

/**
 * Tracks the lifecycle of extracted trade setups:
 *  - trackOpenSetups()  hourly  → PENDING→ENTERED→TP/SL using 1h candles.
 *  - reviewStaleSetups() daily   → EXPIRED (stale PENDING) + INVALID when superseded.
 * All Telegram calls are non-fatal.
 *
 * Invalidation rule: a setup is only invalidated while it is still PENDING (never
 * filled) and a newer, *different* setup for the same symbol has appeared on a later
 * day. Once a setup has filled (ENTERED) it is never invalidated — it runs to TP/SL.
 */
@Injectable()
export class SetupTrackingService {
  private readonly logger = new Logger(SetupTrackingService.name);
  private readonly trackedSetupRepository: TrackedSetupRepository;

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService
  ) {
    this.trackedSetupRepository = createTrackedSetupRepository();
  }

  /** Hourly: advance every open setup against fresh 1h candles. */
  async trackOpenSetups(): Promise<void> {
    const open = await this.trackedSetupRepository.listOpen();
    if (open.length === 0) {
      this.logger.log('No open tracked setups to check');
      return;
    }

    const bySymbol = new Map<string, TrackedSetupRow[]>();
    for (const setup of open) {
      const list = bySymbol.get(setup.symbol) ?? [];
      list.push(setup);
      bySymbol.set(setup.symbol, list);
    }

    for (const [symbol, setups] of bySymbol) {
      try {
        const candles = await this.marketDataService.getCandles(symbol, '1h', TRACK_CANDLE_LIMIT);
        if (candles.length === 0) continue;
        const lastPrice = candles[candles.length - 1]!.close;
        for (const setup of setups) {
          await this.processSetup(setup, candles, lastPrice);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Tracking failed for ${symbol} (non-fatal): ${msg}`);
      }
    }
  }

  private async processSetup(setup: TrackedSetupRow, candles: Candle[], lastPrice: number): Promise<void> {
    const since = setup.lastCheckedAt ? new Date(setup.lastCheckedAt).getTime() : 0;
    const fresh = candles.filter((c) => (c.openTime?.getTime() ?? 0) > since);

    const isLong = setup.direction === 'long';
    let status = setup.status;
    const update: Record<string, unknown> = {};
    const events: string[] = [];

    for (const c of fresh) {
      const t = c.closeTime ?? c.openTime ?? new Date();

      if (status === 'PENDING') {
        const entered = isLong ? c.low <= setup.entryHigh : c.high >= setup.entryLow;
        if (entered) {
          status = 'ENTERED';
          update.status = 'ENTERED';
          update.enteredAt = t;
          events.push('ENTERED');
        }
      }

      if (status === 'ENTERED') {
        // Conservative: a candle that touches both SL and TP is scored as SL.
        const slHit = isLong ? c.low <= setup.stopLoss : c.high >= setup.stopLoss;
        if (slHit) {
          status = 'SL_HIT';
          update.status = 'SL_HIT';
          update.slHitAt = t;
          update.closedAt = t;
          events.push('SL_HIT');
          break;
        }

        if (setup.takeProfit1 != null) {
          const tp1Hit = isLong ? c.high >= setup.takeProfit1 : c.low <= setup.takeProfit1;
          if (tp1Hit && !setup.tp1HitAt && update.tp1HitAt == null) {
            update.tp1HitAt = t;
            events.push('TP1_HIT');
            if (setup.takeProfit2 == null) {
              status = 'TP1_HIT';
              update.status = 'TP1_HIT';
              update.closedAt = t;
              break;
            }
          }
        }

        if (setup.takeProfit2 != null) {
          const tp2Hit = isLong ? c.high >= setup.takeProfit2 : c.low <= setup.takeProfit2;
          if (tp2Hit) {
            if (!setup.tp1HitAt && update.tp1HitAt == null) update.tp1HitAt = t;
            status = 'TP2_HIT';
            update.status = 'TP2_HIT';
            update.tp2HitAt = t;
            update.closedAt = t;
            events.push('TP2_HIT');
            break;
          }
        }
      }
    }

    update.lastCheckedAt = new Date();
    update.lastPrice = lastPrice;

    await this.trackedSetupRepository.update(setup.id, update);

    for (const event of events) {
      await this.notify(setup, event, lastPrice);
    }
  }

  /**
   * Daily: expire stale never-filled PENDING setups, and invalidate a still-PENDING
   * setup once a newer, different setup for the same symbol has superseded it.
   * ENTERED (already filled) setups are left untouched — they run to TP/SL.
   */
  async reviewStaleSetups(): Promise<void> {
    const open = await this.trackedSetupRepository.listOpen();
    if (open.length === 0) {
      this.logger.log('No open tracked setups to review');
      return;
    }

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const symbolSetupsCache = new Map<string, TrackedSetupRow[]>();

    for (const setup of open) {
      try {
        // Once a setup has filled it is never invalidated — let it run to TP/SL.
        if (setup.status !== 'PENDING') continue;

        const planTime = new Date(setup.planDate).getTime();
        const ageDays = (todayUtc.getTime() - planTime) / 86_400_000;

        // Deterministic expiry for never-filled setups.
        if (ageDays >= EXPIRY_DAYS) {
          await this.trackedSetupRepository.update(setup.id, {
            status: 'EXPIRED',
            closedAt: new Date(),
            invalidatedReason: `Không khớp lệnh sau ${EXPIRY_DAYS} ngày`
          });
          this.logger.log(`Setup ${setup.id} (${setup.symbol}) expired`);
          continue;
        }

        // Only previous-day setups can be superseded (skip today's fresh ones).
        if (planTime >= todayUtc.getTime()) continue;

        let symbolSetups = symbolSetupsCache.get(setup.symbol);
        if (!symbolSetups) {
          symbolSetups = await this.trackedSetupRepository.listBySymbol(setup.symbol);
          symbolSetupsCache.set(setup.symbol, symbolSetups);
        }

        // Invalid only when a newer, different setup for this symbol has appeared.
        const newer = symbolSetups.find(
          (s) =>
            s.id !== setup.id &&
            new Date(s.planDate).getTime() > planTime &&
            this.isDifferentSetup(setup, s)
        );
        if (!newer) continue;

        const newerDate = new Date(newer.planDate).toISOString().slice(0, 10);
        const reason = `Lệnh chưa khớp, đã có setup mới khác biệt ngày ${newerDate}`;
        await this.trackedSetupRepository.update(setup.id, {
          status: 'INVALID',
          closedAt: new Date(),
          invalidatedReason: reason
        });
        await this.notify(setup, 'INVALID', setup.lastPrice ?? 0, reason);
        this.logger.log(`Setup ${setup.id} (${setup.symbol}) marked INVALID: ${reason}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Review failed for setup ${setup.id} (non-fatal): ${msg}`);
      }
    }
  }

  /** Two setups differ when their direction flips or their entry zones don't overlap. */
  private isDifferentSetup(a: TrackedSetupRow, b: TrackedSetupRow): boolean {
    if (a.direction !== b.direction) return true;
    const overlap = a.entryHigh >= b.entryLow && b.entryHigh >= a.entryLow;
    return !overlap;
  }

  private async notify(setup: TrackedSetupRow, event: string, price: number, reason?: string): Promise<void> {
    const labels: Record<string, string> = {
      ENTERED: '✅ Đã khớp lệnh',
      TP1_HIT: '🎯 Chạm TP1',
      TP2_HIT: '🎯 Chạm TP2',
      SL_HIT: '🛑 Dính SL',
      INVALID: '⚠️ Setup không còn hợp lệ'
    };
    const dir = setup.direction === 'long' ? 'LONG' : 'SHORT';
    const lines = [
      `${labels[event] ?? event} — ${setup.symbol} ${dir}`,
      `Entry ${setup.entryLow}-${setup.entryHigh} | SL ${setup.stopLoss}` +
        (setup.takeProfit1 != null ? ` | TP1 ${setup.takeProfit1}` : '') +
        (setup.takeProfit2 != null ? ` | TP2 ${setup.takeProfit2}` : ''),
      `Giá: ${price}`
    ];
    if (reason) lines.push(reason);

    try {
      await this.telegramService.sendAnalysisMessage({
        content: lines.join('\n'),
        messageType: 'setup-tracking'
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Telegram notify failed for setup ${setup.id}: ${msg}`);
    }
  }
}
