import { Injectable, Logger } from '@nestjs/common';
import { calculateRsi, formatSwingSignalMessage } from '@app/core';
import { createUserRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';

const RSI_PERIOD = 14;
const RSI_OVERSOLD = 30;
const CANDLE_LIMIT = RSI_PERIOD + 10; // enough candles to compute RSI

@Injectable()
export class SwingSignalService {
  private readonly logger = new Logger(SwingSignalService.name);
  private readonly userRepository = createUserRepository();

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService
  ) {}

  async checkAll(): Promise<void> {
    const user = await this.userRepository.findFirst();
    const symbols: string[] = Array.isArray(user?.symbolsTracking)
      ? (user.symbolsTracking as string[])
      : [];

    if (symbols.length === 0) {
      this.logger.log('SwingSignal: no symbols to check (symbolsTracking empty)');
      return;
    }

    this.logger.log(`SwingSignal: checking ${symbols.length} symbol(s): ${symbols.join(', ')}`);

    for (const symbol of symbols) {
      try {
        await this.checkSymbol(symbol);
      } catch (error) {
        this.logger.error(
          `SwingSignal failed for ${symbol}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }
  }

  private async checkSymbol(symbol: string): Promise<void> {
    const candles = await this.marketDataService.getCandles(symbol, '4h', CANDLE_LIMIT);

    if (candles.length < RSI_PERIOD + 2) {
      this.logger.warn(`SwingSignal: not enough candles for ${symbol}`);
      return;
    }

    const closes = candles.map((c) => c.close);
    const rsi = calculateRsi(closes, RSI_PERIOD);

    this.logger.log(`SwingSignal: ${symbol} RSI(14)=${rsi.toFixed(1)}`);

    if (rsi > RSI_OVERSOLD) return;

    const currentPrice = candles[candles.length - 1]!.close;
    const message = formatSwingSignalMessage({ symbol, rsi, currentPrice });

    await this.telegramService.sendAnalysisMessage({
      content: message,
      messageType: 'swing-signal'
    });

    this.logger.log(`SwingSignal alert sent for ${symbol} (RSI=${rsi.toFixed(1)})`);
  }
}
