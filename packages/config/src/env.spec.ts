import { getConfig, loadEnv } from './env';

describe('config env loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    delete process.env.DATABASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.BINANCE_BASE_URL;
    delete process.env.TRACKED_SYMBOLS;
    delete process.env.ANALYSIS_TIMEFRAME;
    delete process.env.ANALYSIS_CRON;
    delete process.env.LOG_LEVEL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('throws when required provider credentials are missing', () => {
    process.env.DATABASE_URL = 'file:./dev.db';

    expect(() => loadEnv(process.env)).toThrow(/OPENAI_API_KEY/i);
  });

  it('parses tracked symbols and applies defaults', () => {
    process.env.DATABASE_URL = 'file:./dev.db';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.TELEGRAM_BOT_TOKEN = 'telegram-token';
    process.env.TELEGRAM_CHAT_ID = '12345';
    process.env.TRACKED_SYMBOLS = 'BTCUSDT,ETHUSDT';

    const env = loadEnv(process.env);
    const config = getConfig(env);

    expect(config.market.trackedSymbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(config.market.timeframe).toBe('4h');
    expect(config.worker.analysisCron).toBe('1 0 */4 * * *');
    expect(config.logging.level).toBe('debug');
    expect(config.llm.model).toBe('gpt-4o-mini');
  });

  it('fails clearly when telegram configuration is incomplete', () => {
    process.env.DATABASE_URL = 'file:./dev.db';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.TELEGRAM_BOT_TOKEN = 'telegram-token';

    expect(() => loadEnv(process.env)).toThrow(/TELEGRAM_CHAT_ID/i);
  });
});
