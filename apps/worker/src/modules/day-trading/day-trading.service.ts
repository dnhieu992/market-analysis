import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createDayTradingRepository } from '@app/db';
import { BitgetService } from './bitget.service';
import { BitgetWebSocketService } from './bitget-websocket.service';
import { SetupAnalyzerService } from './setup-analyzer.service';
import { SignalExecutorService } from './signal-executor.service';
import { ResultMonitorService } from './result-monitor.service';

const SYMBOL = 'BTCUSDT';
// One 15m candle + buffer — skip if we already fired the same setup this window.
const DEDUP_WINDOW_MS = 14 * 60 * 1000;
// Stand-aside window after a real (non-breakeven) loss. Stops the bot from
// immediately re-entering the same failing idea candle-after-candle in chop —
// the clustered-loss pattern seen on the live feed (multiple stops within ~1h).
const COOLDOWN_AFTER_LOSS_MS = 90 * 60 * 1000;
// Volatility-adaptive stop floor: minimum entry→SL distance = ATR_STOP_MULT ×
// ATR(14) of the 15m entry TF, so stops sit outside normal intrabar noise
// instead of a flat 0.5% that kept getting wicked out.
const ATR_STOP_MULT = 1.0;

@Injectable()
export class DayTradingService implements OnModuleInit {
  private readonly logger = new Logger(DayTradingService.name);
  private readonly repo = createDayTradingRepository();
  private scanning = false;

  constructor(
    private readonly bitget: BitgetService,
    private readonly ws: BitgetWebSocketService,
    private readonly analyzer: SetupAnalyzerService,
    private readonly executor: SignalExecutorService,
    private readonly monitor: ResultMonitorService,
  ) {}

  onModuleInit(): void {
    // PHASE 1: real-time trigger — scan when the public WS reports a 15m close.
    this.ws.on('candleClose', () => {
      void this.runScan('ws-candle-close');
    });
  }

  // Fallback only — runs the scan if the WS feed is unhealthy (missed a close).
  @Cron('2,17,32,47 * * * *', { timeZone: 'UTC' })
  async cronFallbackScan(): Promise<void> {
    if (this.ws.isHealthy()) {
      this.logger.debug('WS healthy — skipping cron fallback scan');
      return;
    }
    this.logger.warn('WS unhealthy — running cron fallback scan');
    await this.runScan('cron-fallback');
  }

  // Fallback monitor. Primary TP/SL detection runs in real time on every WS
  // tick (ResultMonitorService listens to 'price'); this per-minute pass catches
  // open signals if the WS feed stalls/disconnects, using the REST price.
  @Cron('* * * * *', { timeZone: 'UTC' })
  async runResultMonitor(): Promise<void> {
    try {
      await this.monitor.checkActiveSignals();
    } catch (err) {
      this.logger.error(`Result monitor failed: ${this.errMsg(err)}`);
    }
  }

  private async runScan(trigger: string): Promise<void> {
    if (this.scanning) {
      this.logger.debug(`Scan already in progress — skipping (${trigger})`);
      return;
    }
    this.scanning = true;
    try {
      await this.scan();
    } catch (err) {
      this.logger.error(`Day trading scan failed (${trigger}): ${this.errMsg(err)}`);
    } finally {
      this.scanning = false;
    }
  }

  async scan(): Promise<void> {
    const settings = await this.repo.getSettings();

    // Single open position: never stack a second trade while one is still live.
    // The daily-loss guard below only counts CLOSED losers, so without this a burst
    // of correlated entries (e.g. 3 pullback LONGs within 45m) can all open before
    // any closes — then a single adverse candle stops them all out, multiplying the
    // drawdown. Backtest: stacking blew max DD from −17.5R to −182.4R at equal risk.
    const open = await this.repo.findActiveSignals(SYMBOL);
    if (open.length > 0) {
      this.logger.debug(`Position already open for ${SYMBOL} — skipping (no stacking)`);
      return;
    }

    // Daily guards (configurable risk management rules).
    const todayCount = await this.repo.countTodaySignals(SYMBOL);
    if (todayCount >= settings.maxTradesPerDay) {
      this.logger.log(`Max daily trades (${settings.maxTradesPerDay}) reached for ${SYMBOL}`);
      return;
    }

    const todayLosses = await this.repo.countTodayLosses(SYMBOL);
    if (todayLosses >= settings.maxLossesPerDay) {
      this.logger.log(`Max daily losses (${settings.maxLossesPerDay}) reached for ${SYMBOL}`);
      return;
    }

    // Post-loss cooldown: after a real loss, stand aside for a fixed window so a
    // burst of correlated re-entries in chop can't stack up losses.
    const lastLossAt = await this.repo.lastLossClosedAt(SYMBOL);
    if (lastLossAt && Date.now() - lastLossAt.getTime() < COOLDOWN_AFTER_LOSS_MS) {
      const mins = Math.ceil((COOLDOWN_AFTER_LOSS_MS - (Date.now() - lastLossAt.getTime())) / 60000);
      this.logger.log(`Post-loss cooldown for ${SYMBOL} — ${mins}m remaining, skipping`);
      return;
    }

    // Historical candle sets via REST (WS only streams recent candles).
    const [candles15m, candles1h, candles4h] = await Promise.all([
      this.bitget.fetchCandles('15m', 50),
      this.bitget.fetchCandles('1H', 40),
      this.bitget.fetchCandles('4H', 30),
    ]);

    if (!candles15m.length || !candles1h.length || !candles4h.length) {
      this.logger.warn('Failed to fetch candles for day trading scan');
      return;
    }

    const setup = this.analyzer.analyze(candles15m, candles1h, candles4h, {
      riskPerTrade: settings.riskPerTrade,
      minRR: settings.minRR,
      atrMult: ATR_STOP_MULT,
    });
    if (!setup) {
      this.logger.debug('No setup detected');
      return;
    }

    // Dedup: don't re-fire the same setup+direction within one candle window.
    const latest = await this.repo.findLatestSignal(SYMBOL);
    if (
      latest &&
      latest.setupType === setup.setupType &&
      latest.direction === setup.direction &&
      Date.now() - new Date(latest.detectedAt).getTime() < DEDUP_WINDOW_MS
    ) {
      this.logger.debug(`Duplicate setup ${setup.setupType} ${setup.direction} — skipping`);
      return;
    }

    await this.executor.execute(SYMBOL, setup);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
