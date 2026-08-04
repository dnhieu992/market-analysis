import { SchedulerService } from '../src/modules/scheduler/scheduler.service';

describe('SchedulerService', () => {
  function createService() {
    const analysisOrchestratorService = {
      runBatch: jest.fn()
    };
    const visualAnalysisService = {
      analyze: jest.fn().mockResolvedValue({ charts: [], analysisText: 'Daily plan summary' })
    };
    const telegramService = {
      sendPhoto: jest.fn().mockResolvedValue({ success: true, messageId: 1 }),
      sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 1 })
    };
    const swingSignalService = {
      checkAll: jest.fn().mockResolvedValue(undefined)
    };
    const dailySignalService = {
      checkAndSend: jest.fn().mockResolvedValue(undefined)
    };

    return {
      service: new SchedulerService(
        analysisOrchestratorService as never,
        visualAnalysisService as never,
        telegramService as never,
        swingSignalService as never,
        dailySignalService as never,
        { sync: jest.fn().mockResolvedValue({ synced: 0, pages: 0 }) } as never,
        { sync: jest.fn().mockResolvedValue({ synced: 0, pages: 0 }) } as never,
        { trackedSymbols: ['BTCUSDT', 'ETHUSDT'] }
      ),
      visualAnalysisService,
      telegramService,
      dailySignalService
    };
  }

  it('generates and sends a daily plan per tracked symbol', async () => {
    const { service, visualAnalysisService, telegramService, dailySignalService } =
      createService();

    await service.sendDailySignals();

    expect(visualAnalysisService.analyze).toHaveBeenCalledTimes(2);
    expect(visualAnalysisService.analyze).toHaveBeenCalledWith('BTCUSDT');
    expect(visualAnalysisService.analyze).toHaveBeenCalledWith('ETHUSDT');
    expect(telegramService.sendAnalysisMessage).toHaveBeenCalledWith({
      content: 'Daily plan summary',
      messageType: 'daily-plan'
    });
    expect(dailySignalService.checkAndSend).toHaveBeenCalledTimes(1);
  });
});
