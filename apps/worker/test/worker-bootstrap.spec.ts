import { Test } from '@nestjs/testing';

import { AnalysisOrchestratorService } from '../src/modules/analysis/analysis-orchestrator.service';
import { SchedulerService } from '../src/modules/scheduler/scheduler.service';
import { WorkerModule } from '../src/worker.module';

describe('worker bootstrap', () => {
  it('registers the scheduler and analysis orchestrator', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule]
    }).compile();

    expect(moduleRef.get(SchedulerService)).toBeDefined();
    expect(moduleRef.get(AnalysisOrchestratorService)).toBeDefined();
  });
});
