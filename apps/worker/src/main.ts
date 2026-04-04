import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load env vars before the app context is created.
// Note: TS imports are hoisted — dotenv must be called before NestFactory.createApplicationContext, not before imports.
config({ path: resolve(process.cwd(), '.env') });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { formatPriceActionMessage } from './modules/analysis/price-action-signal.formatter';
import { PriceActionSignalService } from './modules/analysis/price-action-signal.service';
import { formatSonicRMessage } from './modules/analysis/sonic-r-signal.formatter';
import { SonicRSignalService } from './modules/analysis/sonic-r-signal.service';
import { BinanceMarketDataService } from './modules/market/binance-market-data.service';
import { SchedulerService } from './modules/scheduler/scheduler.service';
import { TelegramService } from './modules/telegram/telegram.service';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const scheduler = app.get(SchedulerService);
  scheduler.register();

  const telegram = app.get(TelegramService);
  await telegram.sendAnalysisMessage({ content: `🚀 Worker started`, messageType: 'startup' });

  try {
    const binance = app.get(BinanceMarketDataService);
    const price = await binance.fetchPrice('BTCUSDT');
    const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    await telegram.sendAnalysisMessage({ content: `BTC current price: ${fmt(price)} USDT`, messageType: 'test' });

    const sonicR = app.get(SonicRSignalService);
    const sonicRSignal = await sonicR.getSignal('BTCUSDT');
    await telegram.sendAnalysisMessage({
      content: formatSonicRMessage(sonicRSignal),
      messageType: 'sonic-r-signal'
    });

    const priceAction = app.get(PriceActionSignalService);
    const paSignal = await priceAction.getSignal('BTCUSDT');
    await telegram.sendAnalysisMessage({
      content: formatPriceActionMessage(paSignal),
      messageType: 'price-action-signal'
    });
  } catch (error) {
    Logger.error(
      `Startup signal failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      'Bootstrap'
    );
  }

  Logger.log('Worker started', 'Bootstrap');
}

void bootstrap();
