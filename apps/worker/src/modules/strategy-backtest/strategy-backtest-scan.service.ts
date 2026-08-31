import { Injectable, Logger } from '@nestjs/common';
import type { Candle } from '@app/core';
import { computeSetupPnlPct, computeSetupRMultiple } from '@app/core';
import { createStrategyBacktestRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';

type StrategyBacktestRepository = ReturnType<typeof createStrategyBacktestRepository>;
export type StrategyBacktestSetupRow = Awaited<
  ReturnType<StrategyBacktestRepository['listOpen']>
>[number];

/**
 * 5m candles fetched per symbol per pass. The cron runs every 5 minutes, so 3 candles
 * would cover it; 60 (5 hours) is the cheap safety margin that lets a worker restart,
 * a deploy, or a Binance hiccup be replayed instead of silently skipped.
 */
const SCAN_CANDLE_LIMIT = 60;
const SCAN_TIMEFRAME = '5m' as const;

/** The state changes one candle can produce, in the order they are applied. */
type SetupUpdate = {
  status?: string;
  triggeredAt?: Date;
  closedAt?: Date;
  exitPrice?: number;
  pnlPct?: number;
  rMultiple?: number | null;
  lastPrice?: number;
  lastCheckedAt?: Date;
};

/**
 * Advances every open setup on /strategy-backtest against fresh 5m candles, the way
 * a resting limit order on an exchange would behave:
 *
 *   PENDING  → ENTERED  when a candle trades through `entryPrice`
 *   ENTERED  → SL_HIT / TP_HIT  when a candle trades through the stop or target
 *
 * Nothing here decides *whether* a setup is good — the trader wrote it by hand. The
 * job only records what price did, so the page can score the analysis afterwards.
 */
@Injectable()
export class StrategyBacktestScanService {
  private readonly logger = new Logger(StrategyBacktestScanService.name);
  private readonly repository: StrategyBacktestRepository;
  /** Guards against a slow Binance call letting two passes overlap. */
  private scanning = false;

  constructor(private readonly marketDataService: MarketDataService) {
    this.repository = createStrategyBacktestRepository();
  }

  async scan(): Promise<{ checked: number; triggered: number; closed: number }> {
    if (this.scanning) {
      this.logger.warn('Previous strategy-backtest scan still running — skipping this pass');
      return { checked: 0, triggered: 0, closed: 0 };
    }
    this.scanning = true;

    try {
      const open = await this.repository.listOpen();
      if (open.length === 0) return { checked: 0, triggered: 0, closed: 0 };

      const bySymbol = new Map<string, StrategyBacktestSetupRow[]>();
      for (const setup of open) {
        const list = bySymbol.get(setup.symbol) ?? [];
        list.push(setup);
        bySymbol.set(setup.symbol, list);
      }

      let triggered = 0;
      let closed = 0;

      for (const [symbol, setups] of bySymbol) {
        try {
          const candles = await this.marketDataService.getCandles(
            symbol,
            SCAN_TIMEFRAME,
            SCAN_CANDLE_LIMIT
          );
          if (candles.length === 0) continue;
          const lastPrice = candles[candles.length - 1]!.close;

          for (const setup of setups) {
            const result = await this.processSetup(setup, candles, lastPrice);
            if (result.triggered) triggered += 1;
            if (result.closed) closed += 1;
          }
        } catch (error) {
          // Non-fatal: a symbol that fails this pass is simply retried in 5 minutes,
          // and its watermark is untouched so no candle is lost.
          const msg = error instanceof Error ? error.message : 'unknown error';
          this.logger.warn(`Strategy-backtest scan failed for ${symbol} (non-fatal): ${msg}`);
        }
      }

      if (triggered > 0 || closed > 0) {
        this.logger.log(
          `Strategy-backtest scan — ${open.length} open, ${triggered} triggered, ${closed} closed`
        );
      }

      return { checked: open.length, triggered, closed };
    } finally {
      this.scanning = false;
    }
  }

  private async processSetup(
    setup: StrategyBacktestSetupRow,
    candles: Candle[],
    lastPrice: number
  ): Promise<{ triggered: boolean; closed: boolean }> {
    const update = replaySetup(setup, candles);
    update.lastPrice = lastPrice;
    update.lastCheckedAt = new Date();

    await this.repository.update(setup.id, update);

    if (update.status) {
      this.logger.log(
        `Setup ${setup.id} (${setup.symbol} ${setup.direction}) → ${update.status}` +
          (update.exitPrice != null ? ` @ ${update.exitPrice}` : '')
      );
    }

    return {
      triggered: update.triggeredAt != null,
      closed: update.closedAt != null,
    };
  }
}

/**
 * Replays the candles a setup has not seen yet and returns the columns that changed.
 * Pure so it can be unit-tested against hand-written candles.
 *
 * Two rules keep the result honest:
 *  - Candles are only replayed from `lastCheckedAt`, and only from the candle the setup
 *    was created in onwards — otherwise a setup written today would "fill" against this
 *    morning's candles the moment it is saved. The one candle that straddles creation is
 *    kept: dropping it would lose up to 5 minutes of real fills, which is the worse error.
 *  - A candle that trades through both the stop and the target is scored as the stop.
 *    Intra-candle order is unknowable from OHLC, so the pessimistic read is the only
 *    one that cannot flatter the trader's win rate.
 */
export function replaySetup(setup: StrategyBacktestSetupRow, candles: Candle[]): SetupUpdate {
  const since = setup.lastCheckedAt ? new Date(setup.lastCheckedAt).getTime() : 0;
  const createdAt = new Date(setup.createdAt).getTime();
  const fresh = candles.filter((candle) => {
    const openTime = candle.openTime?.getTime() ?? 0;
    const closeTime = candle.closeTime?.getTime() ?? openTime;
    // Keep the in-progress candle that straddles the watermark: its high/low already
    // include ticks the previous pass had not seen.
    return closeTime > since && closeTime >= createdAt;
  });

  const isLong = setup.direction === 'LONG';
  const update: SetupUpdate = {};
  let status = setup.status;

  for (const candle of fresh) {
    const at = candle.closeTime ?? candle.openTime ?? new Date();

    if (status === 'PENDING') {
      // A resting limit fills when price trades through the level: a LONG limit sits
      // below price and needs the low to reach it, a SHORT limit sits above.
      const filled = isLong ? candle.low <= setup.entryPrice : candle.high >= setup.entryPrice;
      if (!filled) continue;
      status = 'ENTERED';
      update.status = 'ENTERED';
      update.triggeredAt = at;
    }

    if (status === 'ENTERED') {
      const slHit = isLong ? candle.low <= setup.stopLoss : candle.high >= setup.stopLoss;
      if (slHit) {
        applyExit(update, setup, 'SL_HIT', setup.stopLoss, at);
        break;
      }

      if (setup.takeProfit != null) {
        const tpHit = isLong
          ? candle.high >= setup.takeProfit
          : candle.low <= setup.takeProfit;
        if (tpHit) {
          applyExit(update, setup, 'TP_HIT', setup.takeProfit, at);
          break;
        }
      }
    }
  }

  return update;
}

function applyExit(
  update: SetupUpdate,
  setup: StrategyBacktestSetupRow,
  status: 'SL_HIT' | 'TP_HIT',
  exitPrice: number,
  at: Date
): void {
  const direction = setup.direction === 'LONG' ? 'LONG' : 'SHORT';
  update.status = status;
  update.closedAt = at;
  update.exitPrice = exitPrice;
  update.pnlPct = computeSetupPnlPct(direction, setup.entryPrice, exitPrice);
  update.rMultiple = computeSetupRMultiple(direction, setup.entryPrice, setup.stopLoss, exitPrice);
}
