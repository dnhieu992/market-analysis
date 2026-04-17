import { SchedulerService } from '../src/modules/scheduler/scheduler.service';

describe('SchedulerService', () => {
  function createService() {
    const analysisOrchestratorService = {
      runBatch: jest.fn()
    };
    const sonicRSignalService = {
      getSignal: jest.fn()
    };
    const priceActionSignalService = {
      getSignal: jest.fn()
    };
    const dailyAnalysisService = {
      analyzeAndSave: jest.fn().mockResolvedValue({
        skipped: false,
        result: { summary: 'Daily plan summary' }
      })
    };
    const telegramService = {
      sendAnalysisMessage: jest.fn().mockResolvedValue({ success: true, messageId: 1 })
    };
    const swingSignalService = {
      checkAll: jest.fn().mockResolvedValue(undefined)
    };

    return {
      service: new SchedulerService(
        analysisOrchestratorService as never,
        dailyAnalysisService as never,
        telegramService as never,
        swingSignalService as never,
        { trackedSymbols: ['BTCUSDT', 'ETHUSDT'] }
      ),
      sonicRSignalService,
      priceActionSignalService,
      dailyAnalysisService,
      telegramService
    };
  }

  it('sends only daily analysis messages during the daily job', async () => {
    const { service, sonicRSignalService, priceActionSignalService, dailyAnalysisService, telegramService } =
      createService();

    await service.sendDailySignals();

    expect(sonicRSignalService.getSignal).not.toHaveBeenCalled();
    expect(priceActionSignalService.getSignal).not.toHaveBeenCalled();
    expect(dailyAnalysisService.analyzeAndSave).toHaveBeenCalledTimes(2);
    expect(dailyAnalysisService.analyzeAndSave).toHaveBeenCalledWith('BTCUSDT');
    expect(dailyAnalysisService.analyzeAndSave).toHaveBeenCalledWith('ETHUSDT');
    expect(telegramService.sendAnalysisMessage).toHaveBeenCalledTimes(2);
    expect(telegramService.sendAnalysisMessage).toHaveBeenCalledWith({
      content: 'Daily plan summary',
      messageType: 'daily-plan'
    });
  });
});
