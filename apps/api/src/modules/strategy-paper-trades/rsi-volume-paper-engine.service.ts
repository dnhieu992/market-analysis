import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AnalysisTimeframe } from '@app/config';
import { createStrategyPaperTradeRepository } from '@app/db';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { PAPER_SYMBOLS, type PaperSymbol } from './paper-symbols';
import {
  RSI_VOLUME_STRATEGIES,
  TF_MS,
  buildContext,
  defaultDocFor,
  firesAt,
  levelsFor,
  stepPosition,
  type ExitReason,
  type PaperCandle,
  type RsiVolumeStrategyDef,
} from './rsi-volume-strategies';
import { StrategyPaperTradesService } from './strategy-paper-trades.service';

const FEE_PCT = 0.0005; // 0.05% per side, same as the backtest

type TradeRow = NonNullable<Awaited<ReturnType<ReturnType<typeof createStrategyPaperTradeRepository>['findById']>>>;

/**
 * Paper-trades the RSI + FxCanli Volume strategies (see rsi-volume-strategies.ts) on every
 * PAPER_SYMBOLS coin. One config per strategy; at most one open trade per (strategy, coin).
 * Every 5 minutes, per strategy and independently: manage its one OPEN trade (`stepPosition`:
 * SL before TP, no end-of-day close), then — if flat — check whether the last CLOSED candle fires and open
 * at the next candle's open. Strategies run in parallel; each holds at most one trade.
 */
@Injectable()
export class RsiVolumePaperEngineService implements OnModuleInit {
  private readonly logger = new Logger(RsiVolumePaperEngineService.name);
  private readonly repo = createStrategyPaperTradeRepository();
  private running = false;

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly board: StrategyPaperTradesService,
  ) {}

  onModuleInit(): void {
    setTimeout(() => {
      this.runTick().catch((e) => this.logger.warn(`initial tick failed: ${e instanceof Error ? e.message : e}`));
    }, 25_000);
  }

  /** 15s after every 5-minute close so the just-closed 5m / 15m candle is final. */
  @Cron('15 */5 * * * *')
  async scheduledTick(): Promise<void> {
    try {
      const r = await this.runTick();
      if (r.opened || r.closed) this.logger.log(`rsi-volume tick: opened=${r.opened} closed=${r.closed}`);
    } catch (e) {
      this.logger.warn(`rsi-volume tick failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async fetch(symbol: string, tf: AnalysisTimeframe, limit: number, startTime?: number): Promise<PaperCandle[]> {
    const raw = startTime != null
      ? await this.binance.fetchKlinesInRange({ symbol, timeframe: tf, startTime, endTime: Date.now(), limit })
      : await this.binance.fetchKlines({ symbol, timeframe: tf, limit });
    return raw.map((k) => ({
      t: Number(k[0]),
      closeT: Number(k[6]),
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
    }));
  }

  async runTick(): Promise<{ opened: number; closed: number }> {
    if (this.running) return { opened: 0, closed: 0 };
    this.running = true;
    try {
      return await this.tick();
    } finally {
      this.running = false;
    }
  }

  private async tick(): Promise<{ opened: number; closed: number }> {
    let opened = 0;
    let closed = 0;
    for (const sym of PAPER_SYMBOLS) {
      try {
        const r = await this.tickSymbol(sym);
        opened += r.opened;
        closed += r.closed;
      } catch (e) {
        this.logger.warn(`[${sym.symbol}] rsi-volume tick failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { opened, closed };
  }

  private async tickSymbol(sym: PaperSymbol): Promise<{ opened: number; closed: number }> {
    const now = Date.now();
    const onlyClosed = (c: PaperCandle[]) => c.filter((x) => x.closeT <= now);
    const [c5, c15, h1All, d1All] = await Promise.all([
      this.fetch(sym.symbol, '5m', 1000),
      this.fetch(sym.symbol, '15m', 1000),
      this.fetch(sym.symbol, '1h', 1000), // ≥ 1000 so the EMA200 trend filter is warmed up
      this.fetch(sym.symbol, '1d', 500),
    ]);
    const all: Record<string, PaperCandle[]> = { '5m': c5, '15m': c15 };
    const h1 = onlyClosed(h1All);
    const d1 = onlyClosed(d1All);
    const price = c5[c5.length - 1]?.close ?? null;

    let opened = 0;
    let closedN = 0;
    for (const def of RSI_VOLUME_STRATEGIES) {
      const id = def.id;
      const config = await this.repo.getConfig(id, {
        name: def.name,
        timeframe: def.timeframe,
        rrPlanned: def.rr,
        docMarkdown: defaultDocFor(def),
      });

      // 1) Manage this strategy's open trade(s).
      for (const trade of await this.repo.findOpen(id, sym.symbol)) {
        if (await this.manage(def, trade, price)) closedN += 1;
      }

      // 2) Flat → does the last closed candle fire?
      if (!config.enabled || (await this.repo.findOpen(id, sym.symbol)).length > 0) continue;
      if (def.symbols && !def.symbols.includes(sym.symbol)) continue; // strategy not run on this coin
      const candles = all[def.timeframe]!;
      const ltf = onlyClosed(candles);
      const i = ltf.length - 1;
      const sig = ltf[i];
      if (!sig || now - sig.closeT > TF_MS[def.timeframe]!) continue; // stale data — skip
      const last = await this.repo.findLastClosed(id, sym.symbol);
      if (last?.closedAt && sig.closeT <= last.closedAt.getTime()) continue; // signal must come after the last exit

      if (!firesAt(def, buildContext(def, ltf, h1, d1), i)) continue;

      const next = candles.find((c) => c.t === sig.closeT + 1);
      const entry = next?.open ?? sig.close;
      const { stop, takeProfit, risk } = levelsFor(def, entry);
      try {
        const created = await this.repo.create({
          strategyId: id,
          symbol: sym.symbol,
          timeframe: def.timeframe,
          tradeDate: new Date(sig.t).toISOString().slice(0, 10),
          direction: def.direction,
          pdh: null,
          pdl: null,
          signalClose: sig.close,
          entryPrice: entry,
          initialStopLoss: stop,
          stopLoss: stop,
          takeProfit,
          riskUsd: config.riskUsd,
          quantity: config.riskUsd / risk,
          rrPlanned: def.rr,
          openedAt: new Date(sig.closeT + 1), // = open time of the entry candle
          lastPrice: price,
          lastCheckedAt: new Date(),
        });
        opened += 1;
        this.logger.log(`[${id} ${sym.short}] opened ${def.direction} @ ${entry.toFixed(1)} SL ${stop.toFixed(1)} TP ${takeProfit.toFixed(1)}`);
        this.board.renderAndAttachEntryChart(created.id).catch((e) =>
          this.logger.warn(`chart render failed for ${created.id}: ${e instanceof Error ? e.message : e}`),
        );
      } catch (e) {
        // Unique (strategyId, openedAt, direction) → this candle was already taken by an overlapping tick.
        this.logger.warn(`[${id} ${sym.short}] open skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { opened, closed: closedN };
  }

  /** Walk closed candles from the entry candle on with `stepPosition` (SL before TP inside a candle). */
  private async manage(def: RsiVolumeStrategyDef, trade: TradeRow, price: number | null): Promise<boolean> {
    const tfMs = TF_MS[trade.timeframe] ?? TF_MS[def.timeframe]!;
    const openedMs = trade.openedAt.getTime();
    // Candles before lastCheckedAt were already checked without a hit; re-check a small overlap —
    // unless the stop was already moved (breakeven), since those older candles predate the move.
    const moved = trade.stopLoss !== trade.initialStopLoss;
    const checkedMs = trade.lastCheckedAt?.getTime() ?? openedMs;
    const from = Math.max(openedMs, moved ? checkedMs : checkedMs - 3 * tfMs);
    const candles = (await this.fetch(trade.symbol, trade.timeframe as AnalysisTimeframe, 1000, from)).filter(
      (c) => c.t >= from && c.closeT <= Date.now(),
    );
    const long = trade.direction === 'LONG';
    const pos = {
      direction: long ? ('LONG' as const) : ('SHORT' as const),
      entryPrice: trade.entryPrice,
      initialStopLoss: trade.initialStopLoss,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      openedAt: openedMs,
    };
    let exit: { price: number; reason: ExitReason; at: number } | null = null;
    for (const c of candles) {
      const step = stepPosition(def, pos, c);
      if (step.exit) { exit = step.exit; break; }
      pos.stopLoss = step.stopLoss;
    }
    const checkedUpTo = candles.length ? new Date(candles[candles.length - 1]!.closeT + 1) : trade.lastCheckedAt ?? new Date(openedMs);
    if (!exit) {
      await this.repo.update(trade.id, { stopLoss: pos.stopLoss, lastPrice: price, lastCheckedAt: checkedUpTo });
      return false;
    }
    const dirSign = long ? 1 : -1;
    const gross = trade.quantity * (exit.price - trade.entryPrice) * dirSign;
    const fee = (trade.quantity * trade.entryPrice + trade.quantity * exit.price) * FEE_PCT;
    const pnl = gross - fee;
    await this.repo.update(trade.id, {
      status: `CLOSED_${exit.reason}`,
      exitPrice: exit.price,
      exitReason: exit.reason,
      pnlUsd: pnl,
      rMultiple: pnl / trade.riskUsd,
      closedAt: new Date(exit.at),
      lastPrice: price,
      lastCheckedAt: new Date(),
    });
    this.logger.log(`[${trade.strategyId} ${trade.symbol}] closed ${trade.direction} ${exit.reason} @ ${exit.price.toFixed(1)} → ${(pnl / trade.riskUsd).toFixed(2)}R`);
    this.board.renderAndAttachEntryChart(trade.id).catch((e) =>
      this.logger.warn(`close-chart render failed for ${trade.id}: ${e instanceof Error ? e.message : e}`),
    );
    return true;
  }
}
