import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { TradeEntryService } from './trade-entry.service';

@ApiTags('trade-entries')
@ApiCookieAuth('market_analysis_session')
@Controller('trade-entries')
export class TradeEntriesController {
  constructor(private readonly service: TradeEntryService) {}

  @Get('strategies')
  @ApiOperation({ summary: 'Entry strategies the trader can declare on an order (latest version of each)' })
  listStrategies() {
    return this.service.listStrategies();
  }

  @Get('check')
  @ApiOperation({ summary: 'Which entry strategies a coin matches right now (live market snapshot)' })
  check(@Query('symbol') symbol: string, @Query('side') side?: string, @Query('exchange') exchange?: string) {
    return this.service.entryCheck({
      symbol,
      side: side === 'short' ? 'short' : 'long',
      exchange: exchange === 'mexc' ? 'mexc' : 'bitget',
    });
  }

  @Get('review')
  @ApiOperation({ summary: 'Per-strategy results of real trades (declared + matched) over the last N days' })
  review(@Query('days') days?: string, @Query('exchange') exchange?: string) {
    return this.service.strategyReview({
      days: days ? Number(days) : undefined,
      exchange: exchange === 'mexc' || exchange === 'bitget' ? exchange : undefined,
    });
  }
}
