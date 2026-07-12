import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddCoinDto } from './dto/add-coin.dto';
import { ScanDto } from './dto/scan.dto';
import { PatternScannerService } from './pattern-scanner.service';

@ApiTags('Pattern Scanner')
@ApiCookieAuth('market_analysis_session')
@Controller('pattern-scanner')
export class PatternScannerController {
  constructor(
    @Inject(PatternScannerService)
    private readonly service: PatternScannerService,
  ) {}

  @Get('coins')
  @ApiOperation({ summary: 'List the pattern-scanner watchlist' })
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

  @Post('scan')
  @ApiOperation({ summary: 'Scan the watchlist for the selected chart patterns on-demand' })
  scan(@Body() body: ScanDto) {
    return this.service.scan(body.patterns, body.timeframe ?? '1d');
  }
}
