import { Inject, Injectable } from '@nestjs/common';
import { createSettingsRepository } from '@app/db';

import { SETTINGS_REPOSITORY } from '../database/database.providers';

type SettingsRepository = ReturnType<typeof createSettingsRepository>;

export type SettingsRecord = {
  id: string;
  name: string;
  trackingSymbols: string[];
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SettingsService {
  constructor(
    @Inject(SETTINGS_REPOSITORY)
    private readonly settingsRepository: SettingsRepository
  ) {}

  async get(): Promise<SettingsRecord | null> {
    const row = await this.settingsRepository.findFirst();
    if (!row) return null;
    return {
      ...row,
      trackingSymbols: Array.isArray(row.trackingSymbols) ? (row.trackingSymbols as string[]) : []
    };
  }

  async upsert(dto: { name: string; trackingSymbols: string[] }): Promise<SettingsRecord> {
    const row = await this.settingsRepository.upsert(dto);
    return {
      ...row,
      trackingSymbols: Array.isArray(row.trackingSymbols) ? (row.trackingSymbols as string[]) : []
    };
  }
}
