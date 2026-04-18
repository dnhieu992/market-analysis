import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load env vars before the app context is created.
// Note: TS imports are hoisted — dotenv must be called before NestFactory.createApplicationContext, not before imports.
const envPath = resolve(process.cwd(), '.env');
const envResult = config({ path: envPath });
// eslint-disable-next-line no-console
console.log('[dotenv] cwd:', process.cwd());
// eslint-disable-next-line no-console
console.log('[dotenv] path:', envPath, '| error:', envResult.error?.message ?? 'none');
const apiKey = process.env.CLAUDE_API_KEY || '';
// eslint-disable-next-line no-console
console.log('[dotenv] CLAUDE_API_KEY:', apiKey || 'MISSING', '| length:', apiKey.length, '| charCodes tail:', [...apiKey.slice(-5)].map(c => c.charCodeAt(0)));
// eslint-disable-next-line no-console
console.log('[dotenv] WORKER_SEND_DAILY_ON_BOOT:', process.env.WORKER_SEND_DAILY_ON_BOOT ?? 'MISSING');
// eslint-disable-next-line no-console
console.log('[dotenv] TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.slice(0, 10) + '...' : 'MISSING');
// eslint-disable-next-line no-console
console.log('[dotenv] TELEGRAM_CHAT_ID:', process.env.TELEGRAM_CHAT_ID ?? 'MISSING');

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { resolveTrackedSymbols } from './config/tracked-symbols';
import { SchedulerService } from './modules/scheduler/scheduler.service';
import { WorkerModule } from './worker.module';

export async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const scheduler = app.get(SchedulerService);
  scheduler.register();

  Logger.log(`WORKER_SEND_DAILY_ON_BOOT = "${process.env.WORKER_SEND_DAILY_ON_BOOT}"`, 'Bootstrap');
  if (process.env.WORKER_SEND_DAILY_ON_BOOT === 'true') {
    Logger.log('Running boot daily analysis...', 'Bootstrap');
    await scheduler.runDailyAnalysisForSymbols(resolveTrackedSymbols());
  }

  Logger.log('Worker started', 'Bootstrap');
}

if (require.main === module) {
  void bootstrap();
}
