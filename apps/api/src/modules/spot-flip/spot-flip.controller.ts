import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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
}
