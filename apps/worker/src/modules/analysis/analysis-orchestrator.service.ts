import { Injectable, Logger, Optional } from '@nestjs/common';
import { buildIndicatorSnapshot, formatAnalysisMessage } from '@app/core';
import type { AnalysisTimeframe } from '@app/config';

import { getLatestClosedCandle } from '../market/utils/candle-timing';
import type { LlmService } from '../llm/llm.service';
import type { MarketDataService } from '../market/market-data.service';
import type { PersistenceService } from '../persistence/persistence.service';
import type { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class AnalysisOrchestratorService {
  private readonly logger = new Logger(AnalysisOrchestratorService.name);
  private readonly timeframe: AnalysisTimeframe;

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly llmService: LlmService,
    private readonly telegramService: TelegramService,
    private readonly persistenceService: PersistenceService,
    @Optional() config?: { timeframe: AnalysisTimeframe }
  ) {
    this.timeframe = config?.timeframe ?? '4h';
  }

  async runBatch(symbols: string[]) {
    this.logger.log(`Preparing analysis batch for ${symbols.length} symbol(s)`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const symbol of symbols) {
      try {
        const outcome = await this.runForSymbol(symbol);

        if (outcome === 'processed') {
          processed += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Failed to process ${symbol}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }

    return {
      scheduled: symbols,
      status: 'completed',
      processed,
      skipped,
      failed
    };
  }

  private async runForSymbol(symbol: string): Promise<'processed' | 'skipped'> {
    let runId: string | null = null;

    try {
      const candles = await this.marketDataService.getCandles(symbol, this.timeframe);
      const latestClosedCandle = getLatestClosedCandle(candles);

      if (!latestClosedCandle?.openTime || !latestClosedCandle.closeTime) {
        throw new Error('No closed candle available');
      }

      const existingRun = await this.persistenceService.findExistingRun(
        symbol,
        this.timeframe,
        latestClosedCandle.closeTime
      );

      if (existingRun) {
        return 'skipped';
      }

      const indicatorSnapshot = buildIndicatorSnapshot(candles);
      const llmInput = {
        symbol,
        timeframe: this.timeframe,
        indicators: indicatorSnapshot
      };

      const analysisRun = await this.persistenceService.startRun({
        symbol,
        timeframe: this.timeframe,
        candleOpenTime: latestClosedCandle.openTime,
        candleCloseTime: latestClosedCandle.closeTime,
        priceOpen: latestClosedCandle.open,
        priceHigh: latestClosedCandle.high,
        priceLow: latestClosedCandle.low,
        priceClose: latestClosedCandle.close,
        rawIndicatorsJson: JSON.stringify(indicatorSnapshot),
        llmInputJson: JSON.stringify(llmInput)
      });

      runId = String((analysisRun as { id: string }).id);

      const signal = await this.llmService.analyzeMarket(llmInput);
      const message = formatAnalysisMessage({
        symbol,
        timeframe: this.timeframe,
        ...signal
      });

      await this.persistenceService.completeRun(runId, symbol, this.timeframe, signal);

      await this.telegramService.sendAnalysisMessage({
        analysisRunId: runId,
        content: message,
        messageType: 'analysis'
      });

      return 'processed';
    } catch (error) {
      if (runId) {
        await this.persistenceService.failRun(
          runId,
          error instanceof Error ? error.message : 'Unknown analysis error'
        );
      } else {
        const failedRun = await this.persistenceService.startRun({
          symbol,
          timeframe: this.timeframe,
          candleOpenTime: new Date(0),
          candleCloseTime: new Date(0),
          priceOpen: 0,
          priceHigh: 0,
          priceLow: 0,
          priceClose: 0,
          rawIndicatorsJson: '{}',
          llmInputJson: '{}'
        });

        await this.persistenceService.failRun(
          String((failedRun as { id: string }).id),
          error instanceof Error ? error.message : 'Unknown analysis error'
        );
      }

      throw error;
    }
  }
}
