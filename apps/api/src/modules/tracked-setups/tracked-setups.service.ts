import { Inject, Injectable } from '@nestjs/common';
import { createTrackedSetupRepository } from '@app/db';

import { TRACKED_SETUP_REPOSITORY } from '../database/database.providers';

type TrackedSetupRepository = ReturnType<typeof createTrackedSetupRepository>;

export type TrackedSetupRecord = Awaited<ReturnType<TrackedSetupRepository['listLatest']>>[number];

@Injectable()
export class TrackedSetupsService {
  constructor(
    @Inject(TRACKED_SETUP_REPOSITORY)
    private readonly trackedSetupRepository: TrackedSetupRepository
  ) {}

  list(symbol?: string): Promise<TrackedSetupRecord[]> {
    return symbol
      ? this.trackedSetupRepository.listBySymbol(symbol, 60)
      : this.trackedSetupRepository.listLatest(60);
  }

  listByPlans(ids: string[]): Promise<TrackedSetupRecord[]> {
    return this.trackedSetupRepository.listByPlanIds(ids);
  }
}
