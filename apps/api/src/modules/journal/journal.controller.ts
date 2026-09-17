import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ReformatJournalDto } from './dto/reformat-journal.dto';
import { UpsertJournalDto } from './dto/upsert-journal.dto';
import { JournalService } from './journal.service';

@ApiTags('Trading Journal')
@ApiCookieAuth('market_analysis_session')
@Controller('journal')
export class JournalController {
  constructor(
    @Inject(JournalService)
    private readonly service: JournalService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List journal entries for a scope (default GENERAL), newest day first' })
  list(@Query('scope') scope?: string) {
    return this.service.list(scope);
  }

  @Get(':date')
  @ApiOperation({ summary: 'Get the journal entry for a calendar day (YYYY-MM-DD) in a scope' })
  getByDate(@Param('date') date: string, @Query('scope') scope?: string) {
    return this.service.getByDate(date, scope);
  }

  @Get(':id/revisions')
  @ApiOperation({ summary: 'List the intra-day save history of an entry, newest first' })
  listRevisions(@Param('id') id: string) {
    return this.service.listRevisions(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update the journal entry for a day' })
  upsert(@Body() body: UpsertJournalDto) {
    return this.service.upsert(body);
  }

  @Post('reformat')
  @ApiOperation({ summary: 'Reformat raw journal markdown via Claude Sonnet (title + section grouping + bold key facts)' })
  reformat(@Body() body: ReformatJournalDto) {
    return this.service.reformat(body.content);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a journal entry by id' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
