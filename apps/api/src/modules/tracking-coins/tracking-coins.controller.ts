import { BadRequestException, Body, Controller, Delete, Get, Header, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddTrackingCoinDto } from './dto/add-tracking-coin.dto';
import { UpdateCoinSetupDto } from './dto/update-coin-setup.dto';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { coinMeta, listPortfolios } from './spot-portfolio';
import { SpotTradesService, type SpotTradeEdit } from './spot-trades.service';
import { TrackingCoinsService } from './tracking-coins.service';

@ApiTags('Tracking Coins')
@ApiCookieAuth('market_analysis_session')
@Controller('tracking-coins')
export class TrackingCoinsController {
  constructor(
    @Inject(TrackingCoinsService)
    private readonly service: TrackingCoinsService,
    @Inject(SpotTradesService)
    private readonly spotTrades: SpotTradesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List the tracked coins (watchlist order)' })
  listCoins() {
    return this.service.listCoins();
  }

  @Get('price-changes')
  // Daily closes; a reload inside a minute can reuse the browser's copy.
  @Header('Cache-Control', 'private, max-age=60')
  @ApiOperation({ summary: '7d / 30d / 90d price change per coin (Binance daily closes)' })
  getPriceChanges(@Query('symbols') symbols = '') {
    const list = symbols.split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.getPriceChanges(list);
  }

  @Get('meta')
  @Header('Cache-Control', 'private, max-age=300')
  @ApiOperation({ summary: 'Market cap (Binance circulating supply × price) and sector labels (L1, L2, Meme, DeFi, AI…) per coin' })
  getMeta(@Query('symbols') symbols = '') {
    return coinMeta(symbols.split(',').map((s) => s.trim()).filter(Boolean));
  }

  @Get('ratings')
  @ApiOperation({ summary: '0–5 star rating per coin' })
  getRatings() {
    return this.service.ratings();
  }

  @Put('coins/:symbol/rating')
  @ApiOperation({ summary: 'Set the 0–5 star rating of a coin' })
  setRating(@Param('symbol') symbol: string, @Body() body: { rating?: number }) {
    const r = Math.round(Number(body?.rating));
    if (!(r >= 0 && r <= 5)) throw new BadRequestException('rating must be 0..5');
    return this.service.setRating(symbol, r);
  }

  @Get('portfolios')
  @ApiOperation({ summary: 'Portfolios the chat can write spot trades to' })
  portfolios(@Req() req: AuthenticatedRequest) {
    return listPortfolios(req.authUser!.id);
  }

  @Get('coins/:symbol/history')
  @ApiOperation({ summary: 'Spot trades confirmed from this page + the coin holdings in each portfolio' })
  history(@Param('symbol') symbol: string, @Req() req: AuthenticatedRequest) {
    return this.spotTrades.history(symbol, req.authUser!.id);
  }

  @Post('spot-trades/:id/confirm')
  @ApiOperation({ summary: 'Confirm a chat-proposed spot trade (optionally edited) → writes the portfolio transaction' })
  confirmSpotTrade(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() body: SpotTradeEdit) {
    const edit: SpotTradeEdit = {};
    if (body?.price != null) edit.price = Number(body.price);
    if (body?.amount != null) edit.amount = Number(body.amount);
    if (body?.portfolioId) edit.portfolioId = String(body.portfolioId);
    if (body?.transactedAt) edit.transactedAt = String(body.transactedAt);
    if (body && 'note' in body) edit.note = body.note == null ? null : String(body.note).slice(0, 2000);
    return this.spotTrades.confirm(id, req.authUser!.id, edit);
  }

  @Post('spot-trades/:id/cancel')
  @ApiOperation({ summary: 'Cancel a chat-proposed spot trade' })
  cancelSpotTrade(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.spotTrades.cancel(id, req.authUser!.id);
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
