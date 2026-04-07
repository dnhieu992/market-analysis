jest.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: jest.fn()
  }
}));

describe('worker main bootstrap', () => {
  const originalSendOnBoot = process.env.WORKER_SEND_DAILY_ON_BOOT;

  afterEach(() => {
    if (originalSendOnBoot === undefined) {
      delete process.env.WORKER_SEND_DAILY_ON_BOOT;
    } else {
      process.env.WORKER_SEND_DAILY_ON_BOOT = originalSendOnBoot;
    }
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('does not send Telegram messages during bootstrap', async () => {
    delete process.env.WORKER_SEND_DAILY_ON_BOOT;

    const { NestFactory } = await import('@nestjs/core');
    const register = jest.fn();
    const sendAnalysisMessage = jest.fn();

    (NestFactory.createApplicationContext as jest.Mock).mockResolvedValue({
      get: jest.fn((token: { name?: string }) => {
        if (token?.name === 'SchedulerService') {
          return { register, runDailyAnalysisForSymbols: jest.fn() };
        }

        if (token?.name === 'TelegramService') {
          return { sendAnalysisMessage };
        }

        return {};
      })
    });

    const { bootstrap } = await import('../src/main');

    await bootstrap();

    expect(register).toHaveBeenCalledTimes(1);
    expect(sendAnalysisMessage).not.toHaveBeenCalled();
  });

  it('runs daily analysis on boot for BTC and ETH when enabled', async () => {
    process.env.WORKER_SEND_DAILY_ON_BOOT = 'true';

    const { NestFactory } = await import('@nestjs/core');
    const register = jest.fn();
    const runDailyAnalysisForSymbols = jest.fn();

    (NestFactory.createApplicationContext as jest.Mock).mockResolvedValue({
      get: jest.fn((token: { name?: string }) => {
        if (token?.name === 'SchedulerService') {
          return { register, runDailyAnalysisForSymbols };
        }

        return {};
      })
    });

    const { bootstrap } = await import('../src/main');

    await bootstrap();

    expect(register).toHaveBeenCalledTimes(1);
    expect(runDailyAnalysisForSymbols).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT']);
  });
});
