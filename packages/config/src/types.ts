export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type AnalysisTimeframe = '5m' | '15m' | 'M30' | '1h' | '4h' | '1d';

export type AppEnv = {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  openAiApiKey: string;
  openAiModel: string;
  telegramBotToken: string;
  telegramChatId: string;
  binanceBaseUrl: string;
  trackedSymbols: string[];
  analysisTimeframe: AnalysisTimeframe;
  analysisCron: string;
  logLevel: LogLevel;
};

export type AppConfig = {
  api: {
    nodeEnv: string;
    port: number;
  };
  database: {
    url: string;
  };
  llm: {
    apiKey: string;
    model: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
  };
  market: {
    baseUrl: string;
    trackedSymbols: string[];
    timeframe: AnalysisTimeframe;
  };
  worker: {
    analysisCron: string;
  };
  logging: {
    level: LogLevel;
  };
};
