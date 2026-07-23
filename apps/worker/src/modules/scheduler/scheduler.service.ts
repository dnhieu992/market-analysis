import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { resolveTrackedSymbols } from '../../config/tracked-symbols';
import { AnalysisOrchestratorService } from '../analysis/analysis-orchestrator.service';
import { BitgetHistoryService } from '../bitget-history/bitget-history.service';
import { DailySignalService } from '../daily-signal/daily-signal.service';
import { SetupExtractionService } from '../setup-tracking/setup-extraction.service';
import { SetupTrackingService } from '../setup-tracking/setup-tracking.service';
import { SmallCapScanService } from '../small-cap-scan/small-cap-scan.service';
import { MemeScanService } from '../meme-scan/meme-scan.service';
import { SwingSignalService } from '../swing-signal/swing-signal.service';
import { TrackingCoinScanService } from '../tracking-coin-scan/tracking-coin-scan.service';
import { EmaStochScanService } from '../ema-stoch-scan/ema-stoch-scan.service';
import { TelegramService } from '../telegram/telegram.service';
import { VisualAnalysisService } from '../visual-analysis/visual-analysis.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly trackedSymbols: string[];

  constructor(
    private readonly analysisOrchestratorService: AnalysisOrchestratorService,
    private readonly visualAnalysisService: VisualAnalysisService,
    private readonly telegramService: TelegramService,
    private readonly swingSignalService: SwingSignalService,
    private readonly dailySignalService: DailySignalService,
    private readonly smallCapScanService: SmallCapScanService,
    private readonly memeScanService: MemeScanService,
    private readonly trackingCoinScanService: TrackingCoinScanService,
    private readonly emaStochScanService: EmaStochScanService,
    private readonly setupExtractionService: SetupExtractionService,
    private readonly setupTrackingService: SetupTrackingService,
    private readonly bitgetHistoryService: BitgetHistoryService,
    @Optional() config?: { trackedSymbols: string[] }
  ) {
    this.trackedSymbols =
      config?.trackedSymbols ?? resolveTrackedSymbols();
  }

  register() {
    this.logger.log('Worker scheduler registered');
  }

  runOnce(symbols = this.trackedSymbols) {
    return this.analysisOrchestratorService.runBatch(symbols);
  }

  // Runs every day at 00:30 UTC (07:30 local time UTC+7)
  @Cron('30 0 * * *', { timeZone: 'UTC' })
  async sendDailySignals() {
    this.logger.log('Running daily signal job');
    await this.runDailyAnalysisForSymbols(this.trackedSymbols);
    await this.dailySignalService.checkAndSend();
  }

  // Runs every day at 00:05 UTC — scan all small-cap watchlist coins
  @Cron('5 0 * * *', { timeZone: 'UTC' })
  async runSmallCapScan() {
    this.logger.log('Running small-cap radar scan');
    try {
      await this.smallCapScanService.scanAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Small-cap scan failed: ${msg}`);
    }
  }

  // Runs every day at 00:07 UTC — scan all meme-radar watchlist coins
  @Cron('7 0 * * *', { timeZone: 'UTC' })
  async runMemeScan() {
    this.logger.log('Running meme radar scan');
    try {
      await this.memeScanService.scanAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Meme scan failed: ${msg}`);
    }
  }

  // Runs every 4 hours at minute 5 (00:05, 04:05, … UTC) — scan all tracking-coin watchlist
  @Cron('5 */4 * * *', { timeZone: 'UTC' })
  async runTrackingCoinScan() {
    this.logger.log('Running tracking-coin scan');
    try {
      const result = await this.trackingCoinScanService.scanAll();
      this.logger.log(`Tracking-coin scan complete — scanned: ${result.scanned}, failed: ${result.failed}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tracking-coin scan failed: ${msg}`);
    }
  }

  // Runs 2 min after each 4h candle close (00:02, 04:02, … UTC) — scan the
  // /ema-bounce watchlist on the 4h timeframe.
  @Cron('0 2 */4 * * *', { timeZone: 'UTC' })
  async runEmaStochScan4h() {
    this.logger.log('Running EMA-bounce scan (4h)');
    try {
      const result = await this.emaStochScanService.scanAll('4h');
      this.logger.log(`EMA-bounce scan (4h) complete — scanned: ${result.scanned}, failed: ${result.failed}, new: ${result.triggered}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`EMA-bounce scan (4h) failed: ${msg}`);
    }
  }

  // Runs 5 min after each daily candle close (00:05 UTC) — scan on the D1 timeframe.
  @Cron('0 5 0 * * *', { timeZone: 'UTC' })
  async runEmaStochScanD1() {
    this.logger.log('Running EMA-bounce scan (1d)');
    try {
      const result = await this.emaStochScanService.scanAll('1d');
      this.logger.log(`EMA-bounce scan (1d) complete — scanned: ${result.scanned}, failed: ${result.failed}, new: ${result.triggered}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`EMA-bounce scan (1d) failed: ${msg}`);
    }
  }

  // Runs every hour — advance open tracked setups (ENTERED / TP / SL)
  @Cron('0 * * * *', { timeZone: 'UTC' })
  async runSetupTracking() {
    this.logger.log('Running tracked-setup hourly check');
    try {
      await this.setupTrackingService.trackOpenSetups();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Setup tracking failed: ${msg}`);
    }
  }

  // Runs every day at 00:45 UTC (after the 00:30 plan generation) — expire stale
  // setups and invalidate those whose premise no longer holds.
  @Cron('45 0 * * *', { timeZone: 'UTC' })
  async runSetupReview() {
    this.logger.log('Running tracked-setup daily review');
    try {
      await this.setupTrackingService.reviewStaleSetups();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Setup review failed: ${msg}`);
    }
  }

  // Runs every 15 seconds — reconcile Bitget open positions + closed history into
  // the bitget_trades lifecycle table (open→closed) so the /bitget history tab +
  // realized PnL survive Bitget's 90-day window, and open/close logs are written.
  // Kept sub-30s (paired with the ~15s web refresh) so a just-closed trade lands
  // in the history tab within ~30s instead of waiting minutes. Each run is cheap
  // (~2 signed calls, watermark-scoped) and guarded against overlap by `syncing`.
  @Cron('*/15 * * * * *', { timeZone: 'UTC' })
  async runBitgetHistorySync() {
    try {
      const res = await this.bitgetHistoryService.sync();
      if (res.opened > 0 || res.closed > 0) {
        this.logger.log(`Bitget trade sync — opened ${res.opened}, closed ${res.closed}`);
      }
    } catch (err) {
      this.logger.error(`Bitget trade sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Runs every minute — record ROE% milestones (+50/+70/+100/+150/+200 and
  // −50/−100/−200/−300/−400/−500) for open Bitget positions onto each trade's
  // journal. Frequent so peaks between the reconcile passes are caught;
  // each step is a one-way ratchet so a milestone is logged once, never on
  // re-crossing after a dip.
  @Cron('* * * * *', { timeZone: 'UTC' })
  async runBitgetMilestoneSync() {
    try {
      await this.bitgetHistoryService.syncMilestones();
    } catch (err) {
      this.logger.error(`Bitget milestone sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // @Cron('0 1 * * *', { timeZone: 'UTC' })
  async runDailySwingScan() {
    this.logger.log('Running daily swing signal scan');
    await this.swingSignalService.checkAll();
  }

  async runDailyAnalysisForSymbols(symbols: string[]) {
    for (const symbol of symbols) {
      try {
        const { charts, analysisText } = await this.visualAnalysisService.analyze(symbol);

        for (const chart of charts) {
          const photoResult = await this.telegramService.sendPhoto(chart.buffer, chart.caption);
          this.logger.log(`sendPhoto result for ${symbol} ${chart.caption}: ${JSON.stringify(photoResult)}`);
        }

        const msgResult = await this.telegramService.sendAnalysisMessage({
          content: analysisText,
          messageType: 'daily-plan'
        });
        this.logger.log(`sendAnalysisMessage result for ${symbol}: ${JSON.stringify(msgResult)}`);

        // Extract trackable trade setups from the freshly-saved plan (non-fatal).
        await this.setupExtractionService.extractForSymbol(symbol);

        this.logger.log(`Daily analysis sent for ${symbol}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        const status = (error as { response?: { status?: number; data?: unknown } }).response?.status;
        const data = (error as { response?: { status?: number; data?: unknown } }).response?.data;
        this.logger.error(`Daily analysis failed for ${symbol}: ${msg}`);
        if (status !== undefined) this.logger.error(`HTTP ${status} — response: ${JSON.stringify(data)}`);
      }
    }
  }
}
