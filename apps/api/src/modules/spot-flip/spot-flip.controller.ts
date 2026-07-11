import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddWatchDto } from './dto/add-watch.dto';
import { AddLogDto } from './dto/add-log.dto';
import { SpotFlipService } from './spot-flip.service';

@ApiTags('Spot Flip')
@ApiCookieAuth('market_analysis_session')
@Controller('spot-flip')
export class SpotFlipController {
  constructor(
    @Inject(SpotFlipService)
    private readonly service: SpotFlipService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Spot-flip metrics for a coin (momentum, dip depth, ATR%)' })
  analyze(@Query('symbol') symbol: string) {
    return this.service.analyze(symbol);
  }

  @Get('history/:symbol')
  @ApiOperation({ summary: 'Stored daily spot-flip snapshots for a coin (up/down %, notes)' })
  history(@Param('symbol') symbol: string) {
    return this.service.history(symbol);
  }

  @Get('watchlist')
  @ApiOperation({ summary: 'List the coins tracked on /spot-flip' })
  listWatch() {
    return this.service.listWatch();
  }

  @Post('watchlist')
  @ApiOperation({ summary: 'Add a coin to the /spot-flip watchlist' })
  addWatch(@Body() body: AddWatchDto) {
    return this.service.addWatch(body.symbol, body.name);
  }

  @Delete('watchlist/:symbol')
  @ApiOperation({ summary: 'Remove a coin from the /spot-flip watchlist' })
  removeWatch(@Param('symbol') symbol: string) {
    return this.service.removeWatch(symbol);
  }

  @Get('logs/:symbol')
  @ApiOperation({ summary: 'List manual logs for a coin (newest first)' })
  listLogs(@Param('symbol') symbol: string) {
    return this.service.listLogs(symbol);
  }

  @Post('logs/:symbol')
  @ApiOperation({ summary: 'Append a timestamped log entry to a coin' })
  addLog(@Param('symbol') symbol: string, @Body() body: AddLogDto) {
    return this.service.addLog(symbol, body.content);
  }

  @Delete('logs/entry/:id')
  @ApiOperation({ summary: 'Delete a single log entry' })
  removeLog(@Param('id') id: string) {
    return this.service.removeLog(id);
  }
}
