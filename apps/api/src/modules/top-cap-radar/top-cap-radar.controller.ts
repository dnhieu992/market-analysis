import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddCoinDto } from './dto/add-coin.dto';
import { TopCapRadarService } from './top-cap-radar.service';

@ApiTags('Top Cap Radar')
@ApiCookieAuth('market_analysis_session')
@Controller('top-cap-radar')
export class TopCapRadarController {
  constructor(
    @Inject(TopCapRadarService)
    private readonly service: TopCapRadarService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all watchlist coins with latest signals' })
  listCoins() {
    return this.service.listCoins();
  }

  @Post('coins')
  @ApiOperation({ summary: 'Add a coin to the top-cap watchlist' })
  addCoin(@Body() body: AddCoinDto) {
    return this.service.addCoin(body.symbol, body.name);
  }

  @Delete('coins/:symbol')
  @ApiOperation({ summary: 'Remove a coin from the top-cap watchlist' })
  removeCoin(@Param('symbol') symbol: string) {
    return this.service.removeCoin(symbol);
  }

  @Post('scan')
  @ApiOperation({ summary: 'Manually trigger a full signal scan for all watchlist coins' })
  triggerScan() {
    return this.service.triggerScan();
  }
}
