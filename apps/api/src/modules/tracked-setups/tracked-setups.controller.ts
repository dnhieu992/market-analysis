import { Body, Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { UpdateTrackedSetupNotesDto } from './dto/update-tracked-setup-notes.dto';
import type { TrackedSetupRecord } from './tracked-setups.service';
import { TrackedSetupsService } from './tracked-setups.service';

@ApiTags('Tracked Setups')
@ApiCookieAuth('market_analysis_session')
@Controller('tracked-setups')
export class TrackedSetupsController {
  constructor(
    @Inject(TrackedSetupsService)
    private readonly trackedSetupsService: TrackedSetupsService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List tracked trade setups (optionally by symbol)' })
  list(@Query('symbol') symbol?: string): Promise<TrackedSetupRecord[]> {
    return this.trackedSetupsService.list(symbol);
  }

  @Get('by-plans')
  @ApiOperation({ summary: 'List tracked setups for the given daily-plan ids (comma-separated)' })
  byPlans(@Query('ids') ids?: string): Promise<TrackedSetupRecord[]> {
    const planIds = (ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.trackedSetupsService.listByPlans(planIds);
  }

  @Patch(':id/notes')
  @ApiOperation({ summary: 'Update the free-text notes for a tracked setup' })
  updateNotes(
    @Param('id') id: string,
    @Body() dto: UpdateTrackedSetupNotesDto
  ): Promise<TrackedSetupRecord> {
    return this.trackedSetupsService.updateNotes(id, dto.notes ?? null);
  }
}
