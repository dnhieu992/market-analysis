import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  @ApiOperation({ summary: 'List all journal entries, newest day first' })
  list() {
    return this.service.list();
  }

  @Get(':date')
  @ApiOperation({ summary: 'Get the journal entry for a calendar day (YYYY-MM-DD)' })
  getByDate(@Param('date') date: string) {
    return this.service.getByDate(date);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update the journal entry for a day' })
  upsert(@Body() body: UpsertJournalDto) {
    return this.service.upsert(body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a journal entry by id' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
