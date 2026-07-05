import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddCoinDto } from './dto/add-coin.dto';
import { MemeRadarService } from './meme-radar.service';

@ApiTags('Meme Radar')
@ApiCookieAuth('market_analysis_session')
@Controller('meme-radar')
export class MemeRadarController {
  constructor(
    @Inject(MemeRadarService)
    private readonly service: MemeRadarService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all meme watchlist coins with latest signals' })
  listCoins() {
    return this.service.listCoins();
  }

  @Post('coins')
  @ApiOperation({ summary: 'Add a coin to the meme watchlist' })
  addCoin(@Body() body: AddCoinDto) {
    return this.service.addCoin(body.symbol, body.name);
  }

  @Delete('coins/:symbol')
  @ApiOperation({ summary: 'Remove a coin from the meme watchlist' })
  removeCoin(@Param('symbol') symbol: string) {
    return this.service.removeCoin(symbol);
  }

  @Get('coins/:symbol/signal-history')
  @ApiOperation({ summary: 'Radar signal change-log (stage changes over time)' })
  getSignalHistory(@Param('symbol') symbol: string, @Query('limit') limit = '100') {
    return this.service.getSignalHistory(symbol, Number(limit));
  }

  @Post('rescan-coins')
  @ApiOperation({ summary: 'Sync meme coin list from Binance/CoinGecko (meme-token category) — runs in background' })
  rescanCoins() {
    return this.service.rescanCoins();
  }

  @Post('scan')
  @ApiOperation({ summary: 'Manually trigger a full signal scan for all meme watchlist coins' })
  triggerScan() {
    return this.service.triggerScan();
  }
}
