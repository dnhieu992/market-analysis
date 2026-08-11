import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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

  @Get('price-changes')
  @ApiOperation({ summary: '7d / 30d / 90d price change per coin (Binance daily closes)' })
  getPriceChanges(@Query('symbols') symbols = '') {
    const list = symbols.split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.getPriceChanges(list);
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

  @Get('coins/:symbol/setup')
  @ApiOperation({ summary: 'Get risk setup settings for a coin' })
  getSetup(@Param('symbol') symbol: string) {
    return this.service.getSetup(symbol);
  }

  @Put('coins/:symbol/setup')
  @ApiOperation({ summary: 'Save risk setup settings for a coin' })
  updateSetup(@Param('symbol') symbol: string, @Body() body: UpdateCoinSetupDto) {
    // Partial update: only the keys present in the body are written, so a dialog that
    // edits one setting cannot wipe the others.
    const patch: Parameters<TrackingCoinsService['updateSetup']>[1] = {};
    if ('swingMaxLoss'    in body) patch.swingMaxLoss    = body.swingMaxLoss    ?? null;
    if ('swingMinRR'      in body) patch.swingMinRR      = body.swingMinRR      ?? null;
    if ('daytradeMaxLoss' in body) patch.daytradeMaxLoss = body.daytradeMaxLoss ?? null;
    if ('daytradeMinRR'   in body) patch.daytradeMinRR   = body.daytradeMinRR   ?? null;
    return this.service.updateSetup(symbol, patch);
  }
}
