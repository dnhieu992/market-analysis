import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createDayTradingRepository } from '@app/db';
import { BitgetService } from './bitget.service';
import { BitgetWebSocketService } from './bitget-websocket.service';
import { SetupAnalyzerService } from './setup-analyzer.service';
import { SignalExecutorService } from './signal-executor.service';
import { ResultMonitorService } from './result-monitor.service';

const SYMBOL = 'BTCUSDT';
const MAX_SIGNALS_PER_DAY = 3;
const MAX_DAILY_LOSS_PCT = -2;
// One 15m candle + buffer — skip if we already fired the same setup this window.
const DEDUP_WINDOW_MS = 14 * 60 * 1000;

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

  // Monitor open signals every minute using the real-time WS price.
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
    // Daily guards (risk management rules).
    const todayCount = await this.repo.countTodaySignals(SYMBOL);
    if (todayCount >= MAX_SIGNALS_PER_DAY) {
      this.logger.log(`Max daily signals (${MAX_SIGNALS_PER_DAY}) reached for ${SYMBOL}`);
      return;
    }

    const todayLoss = await this.repo.getTodayLossPct(SYMBOL);
    if (todayLoss <= MAX_DAILY_LOSS_PCT) {
      this.logger.log(`Daily loss limit reached for ${SYMBOL} (${todayLoss.toFixed(2)}%)`);
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

    const setup = this.analyzer.analyze(candles15m, candles1h, candles4h);
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
