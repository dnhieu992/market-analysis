import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { BitgetJournalService } from './bitget-journal.service';
import { BitgetService } from './bitget.service';
import { ClosePositionDto } from './dto/close-position.dto';
import { OpenPositionDto } from './dto/open-position.dto';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';

@ApiTags('bitget')
@ApiCookieAuth('market_analysis_session')
@Controller('bitget')
export class BitgetController {
  constructor(
    private readonly service: BitgetService,
    private readonly journal: BitgetJournalService,
  ) {}

  @Get('positions')
  @ApiOperation({ summary: 'List all open positions on Bitget USDT futures' })
  getPositions() {
    return this.service.getOpenPositions();
  }

  @Get('history')
  @ApiOperation({ summary: 'Closed-trade history + realized PnL summary (from DB)' })
  getHistory(@Query('limit') limit?: string, @Query('symbol') symbol?: string) {
    const parsed = Number(limit);
    const take = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 200;
    return this.service.getClosedHistory(take, symbol?.trim() || undefined);
  }

  @Post('positions/close')
  @ApiOperation({ summary: 'Force-close a live position at the current market price' })
  closePosition(@Body() dto: ClosePositionDto) {
    return this.service.closePosition(dto.symbol, dto.holdSide);
  }

  @Post('positions/open')
  @ApiOperation({ summary: 'Open a new market position (cross margin) from the Setup tab' })
  openPosition(@Body() dto: OpenPositionDto) {
    return this.service.openPosition(dto);
  }

  @Get('journal')
  @ApiOperation({ summary: 'List manual notes for one trade session (by tradeKey), oldest first' })
  listJournal(@Query('tradeKey') tradeKey: string) {
    return this.journal.list(tradeKey?.trim() ?? '');
  }

  @Post('journal')
  @ApiOperation({ summary: 'Add a manual note to a trade session' })
  createJournal(@Body() dto: CreateJournalDto) {
    return this.journal.create(dto);
  }

  @Put('journal/:id')
  @ApiOperation({ summary: 'Edit an existing trade note' })
  updateJournal(@Param('id') id: string, @Body() dto: UpdateJournalDto) {
    return this.journal.update(id, dto);
  }

  @Delete('journal/:id')
  @ApiOperation({ summary: 'Delete a trade note by id' })
  removeJournal(@Param('id') id: string) {
    return this.journal.remove(id);
  }
}
