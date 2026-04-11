import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { resolveTrackedSymbols } from '../../config/tracked-symbols';
import { AnalysisOrchestratorService } from '../analysis/analysis-orchestrator.service';
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
  }

  async runDailyAnalysisForSymbols(symbols: string[]) {
    for (const symbol of symbols) {
      try {
        const { chartBuffer, analysisText } = await this.visualAnalysisService.analyze(symbol);

        await this.telegramService.sendPhoto(chartBuffer, `${symbol} H4`);
        await this.telegramService.sendAnalysisMessage({
          content: analysisText,
          messageType: 'daily-plan'
        });

        this.logger.log(`Daily analysis sent for ${symbol}`);
      } catch (error) {
        this.logger.error(
          `Daily analysis failed for ${symbol}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }
  }
}
