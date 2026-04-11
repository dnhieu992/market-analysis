import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { SettingsRecord } from './settings.service';
import { SettingsService } from './settings.service';
import { UpsertSettingsDto } from './dto/upsert-settings.dto';

@ApiTags('Settings')
@ApiCookieAuth('market_analysis_session')
@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService)
    private readonly settingsService: SettingsService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get current settings' })
  get(): Promise<SettingsRecord | null> {
    return this.settingsService.get();
  }

  @Put()
  @ApiOperation({ summary: 'Create or update settings' })
  upsert(@Body() body: UpsertSettingsDto): Promise<SettingsRecord> {
    return this.settingsService.upsert(body);
  }
}
