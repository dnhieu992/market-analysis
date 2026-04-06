import type { Provider } from '@nestjs/common';
import {
  createAnalysisRunRepository,
  createDailyAnalysisRepository,
  createOrderRepository,
  createSettingsRepository,
  createSignalRepository,
  createTelegramMessageLogRepository,
  prisma
} from '@app/db';

export const ANALYSIS_RUN_REPOSITORY = Symbol('ANALYSIS_RUN_REPOSITORY');
export const DAILY_ANALYSIS_REPOSITORY = Symbol('DAILY_ANALYSIS_REPOSITORY');
export const SIGNAL_REPOSITORY = Symbol('SIGNAL_REPOSITORY');
export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
export const TELEGRAM_LOG_REPOSITORY = Symbol('TELEGRAM_LOG_REPOSITORY');
export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');

export const DatabaseProviders: Provider[] = [
  {
    provide: 'PRISMA_CLIENT',
    useValue: prisma
  },
  {
    provide: ANALYSIS_RUN_REPOSITORY,
    useFactory: () => createAnalysisRunRepository()
  },
  {
    provide: DAILY_ANALYSIS_REPOSITORY,
    useFactory: () => createDailyAnalysisRepository()
  },
  {
    provide: SIGNAL_REPOSITORY,
    useFactory: () => createSignalRepository()
  },
  {
    provide: ORDER_REPOSITORY,
    useFactory: () => createOrderRepository()
  },
  {
    provide: TELEGRAM_LOG_REPOSITORY,
    useFactory: () => createTelegramMessageLogRepository()
  },
  {
    provide: SETTINGS_REPOSITORY,
    useFactory: () => createSettingsRepository()
  }
];
