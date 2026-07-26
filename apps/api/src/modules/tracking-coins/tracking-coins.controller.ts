import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { AddActivityLogDto, UpdateActivityLogDto } from './dto/activity-log.dto';
import { AddDcaBuyDto, SellDcaDto } from './dto/add-dca-buy.dto';
import { AddTrackingCoinDto } from './dto/add-tracking-coin.dto';
import { UpdateCoinSetupDto } from './dto/update-coin-setup.dto';
import { TrackingCoinsService } from './tracking-coins.service';

@ApiTags('Tracking Coins')
@ApiCookieAuth('market_analysis_session')
@Controller('tracking-coins')
export class TrackingCoinsController {
  constructor(
    @Inject(TrackingCoinsService)
    private readonly service: TrackingCoinsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all manually tracked coins with latest signals' })
  listCoins() {
    return this.service.listCoins();
  }

  @Post('coins')
  @ApiOperation({ summary: 'Add a coin to the tracking list' })
  addCoin(@Body() body: AddTrackingCoinDto) {
    return this.service.addCoin(body.symbol, body.name);
  }

  @Delete('coins/:symbol')
  @ApiOperation({ summary: 'Remove a coin from the tracking list' })
  removeCoin(@Param('symbol') symbol: string) {
    return this.service.removeCoin(symbol);
  }

  @Get('coins/:symbol/klines')
  @ApiOperation({ summary: 'Proxy raw OHLCV klines from Binance (server-side) for prompt embedding' })
  getKlines(
    @Param('symbol') symbol: string,
    @Query('interval') interval = '1d',
    @Query('limit') limit = '100',
  ) {
    return this.service.fetchKlines(symbol, interval, Number(limit));
  }

  @Get('coins/:symbol/activity')
  @ApiOperation({ summary: 'Activity log timeline for a coin (manual notes + buy/sell system entries)' })
  listActivityLogs(@Param('symbol') symbol: string) {
    return this.service.listActivityLogs(symbol);
  }

  @Post('coins/:symbol/activity')
  @ApiOperation({ summary: 'Add a manual note to a coin activity log' })
  addActivityLog(@Param('symbol') symbol: string, @Body() body: AddActivityLogDto) {
    return this.service.addActivityLog(symbol, { content: body.content, images: body.images });
  }

  @Patch('activity/:id')
  @ApiOperation({ summary: 'Edit a manual activity log note (system entries are read-only)' })
  updateActivityLog(@Param('id') id: string, @Body() body: UpdateActivityLogDto) {
    return this.service.updateActivityLog(id, { content: body.content, images: body.images });
  }

  @Delete('activity/:id')
  @ApiOperation({ summary: 'Delete a manual activity log note (system entries are read-only)' })
  deleteActivityLog(@Param('id') id: string) {
    return this.service.deleteActivityLog(id);
  }

  @Get('coins/:symbol/setup')
  @ApiOperation({ summary: 'Get risk setup settings for a coin' })
  getSetup(@Param('symbol') symbol: string) {
    return this.service.getSetup(symbol);
  }

  @Get('coins/:symbol/dca-position')
  @ApiOperation({ summary: 'DCA position for a coin, read from its configured portfolio' })
  getDcaPosition(@Param('symbol') symbol: string, @Req() req: AuthenticatedRequest) {
    return this.service.getDcaPosition(symbol, req.authUser?.id);
  }

  @Post('coins/:symbol/dca-buys')
  @ApiOperation({ summary: 'Buy into the position — writes a BUY transaction in the portfolio' })
  addDcaBuy(@Param('symbol') symbol: string, @Body() body: AddDcaBuyDto, @Req() req: AuthenticatedRequest) {
    return this.service.addDcaBuy(symbol, body, req.authUser?.id);
  }

  @Delete('coins/:symbol/dca-buys/:transactionId')
  @ApiOperation({ summary: 'Remove one layer — deletes the underlying portfolio transaction' })
  deleteDcaBuy(
    @Param('symbol') symbol: string,
    @Param('transactionId') transactionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.deleteDcaBuy(symbol, transactionId, req.authUser?.id);
  }

  @Post('coins/:symbol/dca-sell')
  @ApiOperation({ summary: 'Sell part or all of the position — writes a SELL transaction' })
  sellDcaPosition(@Param('symbol') symbol: string, @Body() body: SellDcaDto, @Req() req: AuthenticatedRequest) {
    return this.service.sellDcaPosition(symbol, body, req.authUser?.id);
  }

  @Put('coins/:symbol/setup')
  @ApiOperation({ summary: 'Save risk setup settings for a coin' })
  updateSetup(@Param('symbol') symbol: string, @Body() body: UpdateCoinSetupDto) {
    // Partial update: only the keys present in the body are written, so a dialog that
    // edits one setting (e.g. the DCA portfolio) cannot wipe the others.
    const patch: Parameters<TrackingCoinsService['updateSetup']>[1] = {};
    if ('swingMaxLoss'    in body) patch.swingMaxLoss    = body.swingMaxLoss    ?? null;
    if ('swingMinRR'      in body) patch.swingMinRR      = body.swingMinRR      ?? null;
    if ('daytradeMaxLoss' in body) patch.daytradeMaxLoss = body.daytradeMaxLoss ?? null;
    if ('daytradeMinRR'   in body) patch.daytradeMinRR   = body.daytradeMinRR   ?? null;
    if ('dcaPortfolioId'  in body) patch.dcaPortfolioId  = body.dcaPortfolioId  || null;
    return this.service.updateSetup(symbol, patch);
  }
}
