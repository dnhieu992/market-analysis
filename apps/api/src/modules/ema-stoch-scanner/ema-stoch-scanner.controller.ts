import { Body, Controller, Delete, Get, Header, Inject, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
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

  @Get('chart')
  @Public() // chart shows only public Binance market data — no auth so <img> works without cookies
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'private, max-age=300')
  @ApiOperation({
    summary: 'Render a full-indicator PNG chart (EMA34/89/200 + S/R + entry/TP), centered on the setup candle',
  })
  async chart(
    @Query('symbol') symbol: string,
    @Query('timeframe') timeframe = '4h',
    @Query('focusTime') focusTime?: string,
    @Query('entry') entry?: string,
    @Query('tp') tp?: string,
  ): Promise<StreamableFile> {
    const toNum = (v?: string) => {
      const n = v != null ? Number(v) : NaN;
      return Number.isFinite(n) ? n : null;
    };

    const buffer = await this.service.generateChart({
      symbol,
      timeframe,
      focusTime: toNum(focusTime),
      entry: toNum(entry),
      tp: toNum(tp),
    });

    return new StreamableFile(buffer);
  }
}
