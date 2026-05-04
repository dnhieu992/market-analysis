import { Injectable, Logger } from '@nestjs/common';
import { isUtBotUptrend } from '@app/core';
import { createUserRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import { TelegramService } from '../telegram/telegram.service';

const M30_CANDLE_LIMIT = 60;
const UT_BOT_PERIOD = 10;
const UT_BOT_MULTIPLIER = 1;

@Injectable()
export class DailySignalService {
  private readonly logger = new Logger(DailySignalService.name);
  private readonly userRepository = createUserRepository();

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly telegramService: TelegramService
  ) {}

  async checkAndSend(): Promise<void> {
    const user = await this.userRepository.findFirst();
    const symbols: string[] = Array.isArray(user?.dailySignalWatchlist)
      ? (user.dailySignalWatchlist as string[])
      : [];

    if (symbols.length === 0) {
      this.logger.log('DailySignal: dailySignalWatchlist is empty, skipping');
      return;
    }

    this.logger.log(`DailySignal: checking ${symbols.length} symbol(s): ${symbols.join(', ')}`);

    const longable: string[] = [];

    for (const symbol of symbols) {
      try {
        const candles = await this.marketDataService.getCandles(symbol, 'M30', M30_CANDLE_LIMIT);
        if (isUtBotUptrend(candles, UT_BOT_PERIOD, UT_BOT_MULTIPLIER)) {
          longable.push(symbol);
          this.logger.log(`DailySignal: ${symbol} — UT Bot uptrend`);
        } else {
          this.logger.log(`DailySignal: ${symbol} — UT Bot downtrend, skip`);
        }
      } catch (error) {
        this.logger.error(
          `DailySignal failed for ${symbol}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }

    const message =
      longable.length > 0
        ? `Coins can long today (UT Bot M30 uptrend):\n${longable.join(', ')}`
        : `Daily Long Signal — No coins qualify today.\n\nChecked: ${symbols.join(', ')}\nNone are in UT Bot M30 uptrend.`;

    await this.telegramService.sendAnalysisMessage({
      content: message,
      messageType: 'daily-long-signal'
    });

    this.logger.log(`DailySignal: sent. Longable: [${longable.join(', ')}]`);
  }
}
