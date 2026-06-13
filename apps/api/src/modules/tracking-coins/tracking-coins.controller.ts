import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddTrackingCoinDto } from './dto/add-tracking-coin.dto';
import { UpsertJournalEntryDto } from './dto/upsert-journal-entry.dto';
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

  @Post('scan')
  @ApiOperation({ summary: 'Manually trigger a full signal scan for all tracked coins' })
  triggerScan() {
    return this.service.triggerScan();
  }

  @Get('coins/:symbol/journal')
  @ApiOperation({ summary: 'List all journal entries for a coin' })
  listJournal(@Param('symbol') symbol: string) {
    return this.service.listJournal(symbol);
  }

  @Put('coins/:symbol/journal')
  @ApiOperation({ summary: 'Create or update a journal entry for a specific date' })
  upsertJournalEntry(@Param('symbol') symbol: string, @Body() body: UpsertJournalEntryDto) {
    return this.service.upsertJournalEntry(symbol, body.date, body.content);
  }

  @Get('coins/:symbol/order-suggestions')
  @ApiOperation({ summary: 'AI-generated limit order suggestions based on PA analysis' })
  suggestOrders(@Param('symbol') symbol: string) {
    return this.service.suggestOrders(symbol);
  }

  @Get('coins/:symbol/orders')
  @ApiOperation({ summary: 'List saved limit orders history for a coin' })
  listOrders(@Param('symbol') symbol: string) {
    return this.service.listOrders(symbol);
  }
}
