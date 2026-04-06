import { Body, Controller, Get, Inject, Put } from '@nestjs/common';

import type { SettingsRecord } from './settings.service';
import { SettingsService } from './settings.service';
import { UpsertSettingsDto } from './dto/upsert-settings.dto';

@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService)
    private readonly settingsService: SettingsService
  ) {}

  @Get()
  get(): Promise<SettingsRecord | null> {
    return this.settingsService.get();
  }

  @Put()
  upsert(@Body() body: UpsertSettingsDto): Promise<SettingsRecord> {
    return this.settingsService.upsert(body);
  }
}
