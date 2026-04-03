import { Injectable, Logger, Optional } from '@nestjs/common';
import type { AnalysisTimeframe } from '@app/config';

import { getLatestClosedCandle, deriveCandleProcessingKey } from '../market/utils/candle-timing';
import type { MarketDataService } from '../market/market-data.service';
import type { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class AnalysisOrchestratorService {
  private readonly logger = new Logger(AnalysisOrchestratorService.name);
  private readonly timeframe: AnalysisTimeframe;
  private readonly processedKeys = new Set<string>();

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService,
    @Optional() config?: { timeframe: AnalysisTimeframe }
  ) {
    this.timeframe = config?.timeframe ?? '4h';
  }

  async runBatch(symbols: string[]) {
    this.logger.log(`Preparing candle signal batch for ${symbols.length} symbol(s)`);

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
    const candles = await this.marketDataService.getCandles(symbol, this.timeframe);
    const latestClosedCandle = getLatestClosedCandle(candles);

    if (!latestClosedCandle?.closeTime) {
      throw new Error('No closed candle available');
    }

    const key = deriveCandleProcessingKey(symbol, this.timeframe, latestClosedCandle.closeTime);

    if (this.processedKeys.has(key)) {
      return 'skipped';
    }

    const message = this.formatMessage(symbol, latestClosedCandle.open, latestClosedCandle.close);

    await this.telegramService.sendAnalysisMessage({
      content: message,
      messageType: 'candle-signal'
    });

    this.processedKeys.add(key);

    return 'processed';
  }

  private formatMessage(symbol: string, open: number, close: number): string {
    const fmt = (n: number) =>
      n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return `[${symbol} ${this.timeframe}] Candle closed\nOpen:  ${fmt(open)} USDT\nClose: ${fmt(close)} USDT`;
  }
}
