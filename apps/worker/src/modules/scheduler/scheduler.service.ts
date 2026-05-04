import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { resolveTrackedSymbols } from '../../config/tracked-symbols';
import { AnalysisOrchestratorService } from '../analysis/analysis-orchestrator.service';
import { DailySignalService } from '../daily-signal/daily-signal.service';
import { SwingSignalService } from '../swing-signal/swing-signal.service';
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

  // Runs every day at 00:00 UTC (07:00 local time UTC+7)
  @Cron('0 0 * * *', { timeZone: 'UTC' })
  async sendDailySignals() {
    this.logger.log('Running daily signal job');
    await this.runDailyAnalysisForSymbols(this.trackedSymbols);
    await this.dailySignalService.checkAndSend();
  }

  // Runs after every H4 candle close: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
  @Cron('0 0,4,8,12,16,20 * * *', { timeZone: 'UTC' })
  async checkSwingSignals() {
    this.logger.log('Running H4 swing signal check');
    await this.swingSignalService.checkAll();
  }

  async runDailyAnalysisForSymbols(symbols: string[]) {
    for (const symbol of symbols) {
      try {
        const { chartBuffer, analysisText } = await this.visualAnalysisService.analyze(symbol);

        const photoResult = await this.telegramService.sendPhoto(chartBuffer, `${symbol} H4`);
        this.logger.log(`sendPhoto result for ${symbol}: ${JSON.stringify(photoResult)}`);

        const msgResult = await this.telegramService.sendAnalysisMessage({
          content: analysisText,
          messageType: 'daily-plan'
        });
        this.logger.log(`sendAnalysisMessage result for ${symbol}: ${JSON.stringify(msgResult)}`);

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
