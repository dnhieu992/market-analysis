import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

import type { AppConfig, AppEnv } from './types';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'TELEGRAM_CHAT_ID is required'),
  BINANCE_BASE_URL: z.string().url().default('https://api.binance.com'),
  TRACKED_SYMBOLS: z.string().default('BTCUSDT'),
  ANALYSIS_TIMEFRAME: z.literal('4h').default('4h'),
  ANALYSIS_CRON: z.string().default('1 0 */4 * * *'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('debug')
});

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  loadDotEnv({ quiet: true });

  const parsed = envSchema.parse(source);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    openAiApiKey: parsed.OPENAI_API_KEY,
    openAiModel: parsed.OPENAI_MODEL,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.TELEGRAM_CHAT_ID,
    binanceBaseUrl: parsed.BINANCE_BASE_URL,
    trackedSymbols: parsed.TRACKED_SYMBOLS.split(',')
      .map((symbol) => symbol.trim())
      .filter(Boolean),
    analysisTimeframe: parsed.ANALYSIS_TIMEFRAME,
    analysisCron: parsed.ANALYSIS_CRON,
    logLevel: parsed.LOG_LEVEL
  };
}

export function getConfig(env: AppEnv): AppConfig {
  return {
    api: {
      nodeEnv: env.nodeEnv,
      port: env.port
    },
    database: {
      url: env.databaseUrl
    },
    llm: {
      apiKey: env.openAiApiKey,
      model: env.openAiModel
    },
    telegram: {
      botToken: env.telegramBotToken,
      chatId: env.telegramChatId
    },
    market: {
      baseUrl: env.binanceBaseUrl,
      trackedSymbols: env.trackedSymbols,
      timeframe: env.analysisTimeframe
    },
    worker: {
      analysisCron: env.analysisCron
    },
    logging: {
      level: env.logLevel
    }
  };
}
