import type { Provider } from '@nestjs/common';
import {
  createAnalysisRunRepository,
  createCoinTransactionRepository,
  createConversationRepository,
  createDailyAnalysisRepository,
  createHoldingRepository,
  createOrderRepository,
  createPnlHistoryRepository,
  createPortfolioRepository,
  createSessionRepository,
  createSettingsRepository,
  createSignalRepository,
  createTelegramMessageLogRepository,
  createTradingStrategyRepository,
  createUserRepository,
  prisma
} from '@app/db';

export const ANALYSIS_RUN_REPOSITORY = Symbol('ANALYSIS_RUN_REPOSITORY');
export const DAILY_ANALYSIS_REPOSITORY = Symbol('DAILY_ANALYSIS_REPOSITORY');
export const SIGNAL_REPOSITORY = Symbol('SIGNAL_REPOSITORY');
export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
export const TELEGRAM_LOG_REPOSITORY = Symbol('TELEGRAM_LOG_REPOSITORY');
export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
export const STRATEGY_REPOSITORY = Symbol('STRATEGY_REPOSITORY');
export const PORTFOLIO_REPOSITORY = Symbol('PORTFOLIO_REPOSITORY');
export const COIN_TRANSACTION_REPOSITORY = Symbol('COIN_TRANSACTION_REPOSITORY');
export const HOLDING_REPOSITORY = Symbol('HOLDING_REPOSITORY');
export const PNL_HISTORY_REPOSITORY = Symbol('PNL_HISTORY_REPOSITORY');
export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');
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
  },
  {
    provide: USER_REPOSITORY,
    useFactory: () => createUserRepository()
  },
  {
    provide: SESSION_REPOSITORY,
    useFactory: () => createSessionRepository()
  },
  {
    provide: STRATEGY_REPOSITORY,
    useFactory: () => createTradingStrategyRepository()
  },
  {
    provide: PORTFOLIO_REPOSITORY,
    useFactory: () => createPortfolioRepository()
  },
  {
    provide: COIN_TRANSACTION_REPOSITORY,
    useFactory: () => createCoinTransactionRepository()
  },
  {
    provide: HOLDING_REPOSITORY,
    useFactory: () => createHoldingRepository()
  },
  {
    provide: PNL_HISTORY_REPOSITORY,
    useFactory: () => createPnlHistoryRepository()
  },
  {
    provide: CONVERSATION_REPOSITORY,
    useFactory: () => createConversationRepository()
  },
];
