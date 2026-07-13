import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { resolveTrackedSymbols } from '../../config/tracked-symbols';
import { AnalysisOrchestratorService } from '../analysis/analysis-orchestrator.service';
import { DailySignalService } from '../daily-signal/daily-signal.service';
import { DcaLadderSyncService } from '../dca-ladder/dca-ladder.service';
import { SetupExtractionService } from '../setup-tracking/setup-extraction.service';
import { SetupTrackingService } from '../setup-tracking/setup-tracking.service';
import { SmallCapScanService } from '../small-cap-scan/small-cap-scan.service';
import { MemeScanService } from '../meme-scan/meme-scan.service';
import { SpotFlipDailyService } from '../spot-flip-daily/spot-flip-daily.service';
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
    private readonly spotFlipDailyService: SpotFlipDailyService,
    private readonly trackingCoinScanService: TrackingCoinScanService,
    private readonly emaStochScanService: EmaStochScanService,
    private readonly setupExtractionService: SetupExtractionService,
    private readonly setupTrackingService: SetupTrackingService,
    private readonly dcaLadderSyncService: DcaLadderSyncService,
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

  // Runs every day at 00:15 UTC — snapshot every spot-flip watchlist coin
  // (up/down ratio + range/ATR metrics + stance note) into spot_flip_daily.
  @Cron('15 0 * * *', { timeZone: 'UTC' })
  async runSpotFlipDaily() {
    this.logger.log('Running spot-flip daily snapshot');
    try {
      await this.spotFlipDailyService.runDaily();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Spot-flip daily snapshot failed: ${msg}`);
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
  // /ema-bounce watchlist for EMA-stack oversold StochRSI entries.
  @Cron('0 2 */4 * * *', { timeZone: 'UTC' })
  async runEmaStochScan() {
    this.logger.log('Running EMA-bounce scan');
    try {
      const result = await this.emaStochScanService.scanAll();
      this.logger.log(`EMA-bounce scan complete — scanned: ${result.scanned}, failed: ${result.failed}, new: ${result.triggered}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`EMA-bounce scan failed: ${msg}`);
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

  // Runs every day at 00:10 UTC — sync the BTC DCA ladder against the closed daily candle
  @Cron('10 0 * * *', { timeZone: 'UTC' })
  async runDcaLadderSync() {
    this.logger.log('Running DCA ladder daily sync');
    try {
      const res = await this.dcaLadderSyncService.syncDaily();
      this.logger.log(`DCA ladder sync — touched: ${res.touchedTiers.length}, tpReady: ${res.tpReady}`);
    } catch (err) {
      this.logger.error(`DCA ladder sync failed: ${err instanceof Error ? err.message : String(err)}`);
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
