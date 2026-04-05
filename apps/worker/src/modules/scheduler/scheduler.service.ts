import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { formatPriceActionMessage } from '../analysis/price-action-signal.formatter';
import { PriceActionSignalService } from '../analysis/price-action-signal.service';
import { formatSonicRMessage } from '../analysis/sonic-r-signal.formatter';
import { SonicRSignalService } from '../analysis/sonic-r-signal.service';
import { AnalysisOrchestratorService } from '../analysis/analysis-orchestrator.service';
import { DailyAnalysisService } from '../analysis/daily-analysis.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly trackedSymbols: string[];

  constructor(
    private readonly analysisOrchestratorService: AnalysisOrchestratorService,
    private readonly sonicRSignalService: SonicRSignalService,
    private readonly priceActionSignalService: PriceActionSignalService,
    private readonly dailyAnalysisService: DailyAnalysisService,
    private readonly telegramService: TelegramService,
    @Optional() config?: { trackedSymbols: string[] }
  ) {
    this.trackedSymbols =
      config?.trackedSymbols ??
      (process.env.TRACKED_SYMBOLS ?? 'BTCUSDT')
        .split(',')
        .map((symbol) => symbol.trim())
        .filter(Boolean);
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

    for (const symbol of this.trackedSymbols) {
      try {
        const [sonicRSignal, paSignal] = await Promise.all([
          this.sonicRSignalService.getSignal(symbol),
          this.priceActionSignalService.getSignal(symbol)
        ]);

        await this.telegramService.sendAnalysisMessage({
          content: formatSonicRMessage(sonicRSignal),
          messageType: 'sonic-r-signal'
        });

        await this.telegramService.sendAnalysisMessage({
          content: formatPriceActionMessage(paSignal),
          messageType: 'price-action-signal'
        });

        const { result } = await this.dailyAnalysisService.analyzeAndSave(symbol);

        await this.telegramService.sendAnalysisMessage({
          content: result.summary,
          messageType: 'daily-plan'
        });

        this.logger.log(`Daily signals sent for ${symbol}`);
      } catch (error) {
        this.logger.error(
          `Daily signal failed for ${symbol}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }
  }
}
