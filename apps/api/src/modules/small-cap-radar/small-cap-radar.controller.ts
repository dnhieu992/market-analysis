import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddCoinDto } from './dto/add-coin.dto';
import { SmallCapRadarService } from './small-cap-radar.service';

@ApiTags('Small Cap Radar')
@ApiCookieAuth('market_analysis_session')
@Controller('small-cap-radar')
export class SmallCapRadarController {
  constructor(
    @Inject(SmallCapRadarService)
    private readonly service: SmallCapRadarService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all watchlist coins with latest signals' })
  listCoins() {
    return this.service.listCoins();
  }

  @Post('coins')
  @ApiOperation({ summary: 'Add a coin to the small-cap watchlist' })
  addCoin(@Body() body: AddCoinDto) {
    return this.service.addCoin(body.symbol, body.name);
  }

  @Delete('coins/:symbol')
  @ApiOperation({ summary: 'Remove a coin from the small-cap watchlist' })
  removeCoin(@Param('symbol') symbol: string) {
    return this.service.removeCoin(symbol);
  }

  @Get('coins/:symbol/signal-history')
  @ApiOperation({ summary: 'Radar signal change-log (stage changes over time)' })
  getSignalHistory(@Param('symbol') symbol: string, @Query('limit') limit = '100') {
    return this.service.getSignalHistory(symbol, Number(limit));
  }

  @Post('rescan-coins')
  @ApiOperation({ summary: 'Sync coin list from Binance/CoinGecko (<50M market cap) — runs in background' })
  rescanCoins() {
    return this.service.rescanCoins();
  }

  @Post('scan')
  @ApiOperation({ summary: 'Manually trigger a full signal scan for all watchlist coins' })
  triggerScan() {
    return this.service.triggerScan();
  }
}
