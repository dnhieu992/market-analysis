import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddJunkCoinsDto } from './dto/add-junk-coins.dto';
import { UpdateJunkCoinDto } from './dto/update-junk-coin.dto';
import { JunkShortService } from './junk-short.service';
import { JunkShortStatsService } from './junk-short-stats.service';

@ApiTags('junk-short')
@ApiCookieAuth('market_analysis_session')
@Controller('junk-short')
export class JunkShortController {
  constructor(
    @Inject(JunkShortService) private readonly service: JunkShortService,
    @Inject(JunkShortStatsService) private readonly statsService: JunkShortStatsService,
  ) {}

  @Get('coins/stats')
  @ApiOperation({ summary: 'Live Binance stats per listed coin: cap, 24h/3D/7D/30D/90D, funding + interval, ecosystem, listing dates' })
  stats() {
    return this.statsService.stats();
  }

  @Get('coins')
  @ApiOperation({ summary: 'The /short-junk coin list (the only coins the short-junk skill scans)' })
  list() {
    return this.service.list();
  }

  @Post('coins')
  @ApiOperation({ summary: 'Add coins (must have a Binance USDT-M perpetual); returns added + rejected' })
  add(@Body() dto: AddJunkCoinsDto) {
    return this.service.add(dto);
  }

  @Post('coins/sync')
  @ApiOperation({ summary: 'Add every coin passing the study’s junk gates on Binance today (never removes)' })
  sync() {
    return this.service.syncFromBinance();
  }

  @Patch('coins/:symbol')
  @ApiOperation({ summary: 'Edit a coin’s note' })
  update(@Param('symbol') symbol: string, @Body() dto: UpdateJunkCoinDto) {
    return this.service.update(symbol, dto.note);
  }

  @Delete('coins/:symbol')
  @ApiOperation({ summary: 'Remove a coin from the list' })
  remove(@Param('symbol') symbol: string) {
    return this.service.remove(symbol);
  }
}
