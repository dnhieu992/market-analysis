import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { TradingListService } from './trading-list.service';
import { AddTradingListWatchlistDto } from './dto/add-trading-list-watchlist.dto';
import { UpsertTradingListNoteDto } from './dto/upsert-trading-list-note.dto';
import { UpsertTradingListPriorityDto } from './dto/upsert-trading-list-priority.dto';

@ApiTags('trading-list')
@ApiCookieAuth('market_analysis_session')
@Controller('trading-list')
export class TradingListController {
  constructor(private readonly service: TradingListService) {}

  @Get('priority')
  @ApiOperation({ summary: 'Star priority (0–5) of every rated coin on /trading-list' })
  listPriorities() {
    return this.service.listPriorities();
  }

  @Put('priority')
  @ApiOperation({ summary: 'Set one coin’s star priority (shared by Bitget + MEXC on /trading-list)' })
  upsertPriority(@Body() dto: UpsertTradingListPriorityDto) {
    return this.service.upsertPriority(dto);
  }

  @Get('note')
  @ApiOperation({ summary: 'The trader’s assessment of every coin on /trading-list' })
  listNotes() {
    return this.service.listNotes();
  }

  @Put('note')
  @ApiOperation({ summary: 'Save (or clear, with an empty note) one coin’s assessment' })
  upsertNote(@Body() dto: UpsertTradingListNoteDto) {
    return this.service.upsertNote(dto);
  }

  @Get('watchlist')
  @ApiOperation({ summary: 'Coins added to /trading-list by hand' })
  listWatchlist() {
    return this.service.listWatchlist();
  }

  @Post('watchlist')
  @ApiOperation({ summary: 'Track a new coin (must list on Bitget or MEXC futures)' })
  addWatchlistSymbol(@Body() dto: AddTradingListWatchlistDto) {
    return this.service.addWatchlistSymbol(dto);
  }

  @Delete('watchlist/:symbol')
  @ApiOperation({ summary: 'Stop tracking a hand-added coin' })
  removeWatchlistSymbol(@Param('symbol') symbol: string) {
    return this.service.removeWatchlistSymbol(symbol);
  }
}
