import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddDcaBuyDto } from './dto/add-dca-buy.dto';
import { AddTrackingCoinDto } from './dto/add-tracking-coin.dto';
import { UpsertJournalEntryDto } from './dto/upsert-journal-entry.dto';
import { UpdateCoinSetupDto } from './dto/update-coin-setup.dto';
import { UpdateOrderNotesDto } from './dto/update-order-notes.dto';
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

  @Get('coins/:symbol/klines')
  @ApiOperation({ summary: 'Proxy raw OHLCV klines from Binance (server-side) for prompt embedding' })
  getKlines(
    @Param('symbol') symbol: string,
    @Query('interval') interval = '1d',
    @Query('limit') limit = '100',
  ) {
    return this.service.fetchKlines(symbol, interval, Number(limit));
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

  @Get('coins/:symbol/setup')
  @ApiOperation({ summary: 'Get risk setup settings for a coin' })
  getSetup(@Param('symbol') symbol: string) {
    return this.service.getSetup(symbol);
  }

  @Get('coins/:symbol/dca-position')
  @ApiOperation({ summary: 'Get the DCA position (buy log + average + P&L) for a coin' })
  getDcaPosition(@Param('symbol') symbol: string) {
    return this.service.getDcaPosition(symbol);
  }

  @Post('coins/:symbol/dca-buys')
  @ApiOperation({ summary: 'Log a DCA buy (layer) for a coin' })
  addDcaBuy(@Param('symbol') symbol: string, @Body() body: AddDcaBuyDto) {
    return this.service.addDcaBuy(symbol, body);
  }

  @Delete('coins/:symbol/dca-buys/:buyId')
  @ApiOperation({ summary: 'Delete a single DCA buy' })
  deleteDcaBuy(@Param('symbol') symbol: string, @Param('buyId') buyId: string) {
    return this.service.deleteDcaBuy(symbol, buyId);
  }

  @Delete('coins/:symbol/dca-position')
  @ApiOperation({ summary: 'Close (clear) the entire DCA position for a coin' })
  closeDcaPosition(@Param('symbol') symbol: string) {
    return this.service.closeDcaPosition(symbol);
  }

  @Patch('coins/orders/:orderId/notes')
  @HttpCode(204)
  @ApiOperation({ summary: 'Update notes for a saved limit order' })
  updateOrderNotes(@Param('orderId') orderId: string, @Body() body: UpdateOrderNotesDto) {
    return this.service.updateOrderNotes(orderId, body.notes ?? null);
  }

  @Put('coins/:symbol/setup')
  @ApiOperation({ summary: 'Save risk setup settings for a coin' })
  updateSetup(@Param('symbol') symbol: string, @Body() body: UpdateCoinSetupDto) {
    return this.service.updateSetup(symbol, {
      swingMaxLoss:    body.swingMaxLoss    ?? null,
      swingMinRR:      body.swingMinRR      ?? null,
      daytradeMaxLoss: body.daytradeMaxLoss ?? null,
      daytradeMinRR:   body.daytradeMinRR   ?? null,
    });
  }
}
