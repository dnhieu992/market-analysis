import { SchedulerService } from '../src/modules/scheduler/scheduler.service';

describe('SchedulerService', () => {
  function createService() {
    const analysisOrchestratorService = {
      runBatch: jest.fn()
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
        swingSignalService as never,
        dailySignalService as never,
        { sync: jest.fn().mockResolvedValue({ synced: 0, pages: 0 }) } as never,
        { sync: jest.fn().mockResolvedValue({ synced: 0, pages: 0 }) } as never,
        { trackedSymbols: ['BTCUSDT', 'ETHUSDT'] }
      ),
      dailySignalService
    };
  }

  // The auto daily plan was dropped from this job on 2026-08-05 — the 00:30 UTC
  // cron now only runs the daily long signal.
  it('runs the daily long signal and nothing else', async () => {
    const { service, dailySignalService } = createService();

    await service.sendDailySignals();

    expect(dailySignalService.checkAndSend).toHaveBeenCalledTimes(1);
  });
});
