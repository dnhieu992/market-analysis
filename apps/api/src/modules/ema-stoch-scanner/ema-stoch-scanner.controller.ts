import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddCoinDto } from './dto/add-coin.dto';
import { EmaStochScannerService } from './ema-stoch-scanner.service';

@ApiTags('EMA Bounce Scanner')
@ApiCookieAuth('market_analysis_session')
@Controller('ema-bounce')
export class EmaStochScannerController {
  constructor(
    @Inject(EmaStochScannerService)
    private readonly service: EmaStochScannerService,
  ) {}

  @Get('coins')
  @ApiOperation({ summary: 'List the EMA-bounce watchlist' })
  listCoins() {
    return this.service.listCoins();
  }

  @Post('coins')
  @ApiOperation({ summary: 'Add a coin to the watchlist' })
  addCoin(@Body() body: AddCoinDto) {
    return this.service.addCoin(body.symbol, body.name);
  }

  @Delete('coins/:symbol')
  @ApiOperation({ summary: 'Remove a coin from the watchlist' })
  removeCoin(@Param('symbol') symbol: string) {
    return this.service.removeCoin(symbol);
  }

  @Get('signals')
  @ApiOperation({ summary: 'List persisted signal cards (worker-produced), newest first' })
  listSignals(@Query('open') open?: string) {
    return this.service.listSignals(open === 'true' || open === '1');
  }

  @Post('preview')
  @ApiOperation({ summary: 'Live non-persisting scan — which watched coins match on the last closed 4h candle' })
  preview() {
    return this.service.preview();
  }
}
