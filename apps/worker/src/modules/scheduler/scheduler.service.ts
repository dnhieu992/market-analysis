import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { resolveTrackedSymbols } from '../../config/tracked-symbols';
import { AnalysisOrchestratorService } from '../analysis/analysis-orchestrator.service';
import { BitgetHistoryService } from '../bitget-history/bitget-history.service';
import { MexcHistoryService } from '../mexc-history/mexc-history.service';
import { DailySignalService } from '../daily-signal/daily-signal.service';
import { SwingSignalService } from '../swing-signal/swing-signal.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly trackedSymbols: string[];

  constructor(
    private readonly analysisOrchestratorService: AnalysisOrchestratorService,
    private readonly swingSignalService: SwingSignalService,
    private readonly dailySignalService: DailySignalService,
    private readonly bitgetHistoryService: BitgetHistoryService,
    private readonly mexcHistoryService: MexcHistoryService,
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
  //
  // The auto daily plan (charts + Claude Vision analysis pushed to Telegram)
  // was dropped from this job on 2026-08-05 at the trader's request. Its only
  // consumer was that Telegram message — the /daily-plan page and its API went
  // away on 2026-08-04 — so generating it cost a vision call per symbol for
  // rows nobody reads. `VisualAnalysisService` is left in place, unwired, if it
  // is ever wanted back.
  @Cron('30 0 * * *', { timeZone: 'UTC' })
  async sendDailySignals() {
    this.logger.log('Running daily signal job');
    await this.dailySignalService.checkAndSend();
  }

  // Small-cap radar (00:05 UTC) and meme radar (00:07 UTC) scans removed
  // together with their pages (2026-08-04).

  // Tracking-coin signal scan removed (2026-07-26 refactor step 1) — the
  // indicator/scoring helpers stay in @app/core for the rebuilt flow.

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

  // Runs every 15 seconds — the MEXC twin of the Bitget sync above: reconcile
  // open positions + closed history into the mexc_trades lifecycle table so the
  // /mexc history tab + realized PnL are permanent, and open/close logs are
  // written. Same cadence and overlap guard; the two syncs are independent, so a
  // MEXC outage never stalls the Bitget one.
  @Cron('*/15 * * * * *', { timeZone: 'UTC' })
  async runMexcHistorySync() {
    try {
      const res = await this.mexcHistoryService.sync();
      if (res.opened > 0 || res.closed > 0) {
        this.logger.log(`MEXC trade sync — opened ${res.opened}, closed ${res.closed}`);
      }
    } catch (err) {
      this.logger.error(`MEXC trade sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Runs every minute — ROE% milestones for open MEXC positions, same ratchet
  // rules as the Bitget milestone sync.
  @Cron('* * * * *', { timeZone: 'UTC' })
  async runMexcMilestoneSync() {
    try {
      await this.mexcHistoryService.syncMilestones();
    } catch (err) {
      this.logger.error(`MEXC milestone sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // @Cron('0 1 * * *', { timeZone: 'UTC' })
  async runDailySwingScan() {
    this.logger.log('Running daily swing signal scan');
    await this.swingSignalService.checkAll();
  }

}
