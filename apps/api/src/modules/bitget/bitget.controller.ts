import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
import { BitgetJournalService } from './bitget-journal.service';
import { BitgetService } from './bitget.service';
import { BitgetSetupService } from './bitget-setup.service';
import { BitgetSetupChartService } from './bitget-setup-chart.service';
import { ClosePositionDto } from './dto/close-position.dto';
import { OpenPositionDto } from './dto/open-position.dto';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { UpsertSetupConfigDto } from './dto/upsert-setup-config.dto';
import { SaveTradeChartDto } from './dto/save-trade-chart.dto';
import { SaveSetupChartDto } from './dto/save-setup-chart.dto';
import type { TradeChartParams } from './bitget-setup-chart.service';

@ApiTags('bitget')
@ApiCookieAuth('market_analysis_session')
@Controller('bitget')
export class BitgetController {
  constructor(
    private readonly service: BitgetService,
    private readonly journal: BitgetJournalService,
    private readonly setup: BitgetSetupService,
    private readonly setupChart: BitgetSetupChartService,
  ) {}

  @Get('positions')
  @ApiOperation({ summary: 'List all open positions on Bitget USDT futures' })
  getPositions() {
    return this.service.getOpenPositions();
  }

  @Get('history')
  @ApiOperation({ summary: 'Closed-trade history + realized PnL summary (from DB)' })
  getHistory(@Query('limit') limit?: string, @Query('symbol') symbol?: string) {
    const parsed = Number(limit);
    const take = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 200;
    return this.service.getClosedHistory(take, symbol?.trim() || undefined);
  }

  @Post('positions/close')
  @ApiOperation({ summary: 'Force-close a live position at the current market price' })
  closePosition(@Body() dto: ClosePositionDto) {
    return this.service.closePosition(dto.symbol, dto.holdSide);
  }

  @Post('positions/open')
  @ApiOperation({ summary: 'Open a new market position (cross margin) from the Setup tab' })
  openPosition(@Body() dto: OpenPositionDto) {
    return this.service.openPosition(dto);
  }

  @Get('setup')
  @ApiOperation({ summary: 'List saved per-coin, per-side open configs for the Setup tab' })
  listSetup() {
    return this.setup.list();
  }

  @Put('setup')
  @ApiOperation({ summary: 'Save (upsert) the open config for one coin + side' })
  upsertSetup(@Body() dto: UpsertSetupConfigDto) {
    return this.setup.upsert(dto);
  }

  @Get('setup-chart')
  @Public() // chart shows only public Binance market data — no auth so <img> works without cookies
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'private, max-age=120')
  @ApiOperation({
    summary: 'Render a PNG chart (SonicR system + S/R channels + RSI) for a Setup-tab coin. timeframe: M30 | 1h | 4h | 1d',
  })
  async setupChartPng(
    @Query('symbol') symbol: string,
    @Query('timeframe') timeframe?: string,
  ): Promise<StreamableFile> {
    const buffer = await this.setupChart.generateChart(symbol, timeframe ?? 'M30');
    return new StreamableFile(buffer);
  }

  @Get('qqe-signals')
  @ApiOperation({
    summary: 'Current colinmck QQE Signals state (long/short) per timeframe (M30/1h/4h/1d) for the given coins. `symbols` is comma-separated.',
  })
  getQqeSignals(@Query('symbols') symbols?: string) {
    const list = (symbols ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.setupChart.getQqeSignals(list);
  }

  @Get('trade-chart')
  @Public() // uses only public Binance market data + trade prices passed in the query
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'private, max-age=120')
  @ApiOperation({
    summary: 'Render a review PNG chart for one closed trade, windowed on its open/close window',
  })
  async tradeChartPng(@Query() q: Record<string, string>): Promise<StreamableFile> {
    const buffer = await this.setupChart.generateTradeChart(this.parseTradeChartQuery(q));
    return new StreamableFile(buffer);
  }

  @Post('trade-chart/save')
  @ApiOperation({ summary: 'Render the trade chart, upload it to R2, and store the DB link' })
  saveTradeChart(@Body() dto: SaveTradeChartDto) {
    return this.setupChart.saveTradeChart({ ...dto, holdSide: dto.holdSide });
  }

  @Post('setup-chart/save')
  @ApiOperation({ summary: 'Snapshot the live Setup-tab chart to R2 and store the DB link' })
  saveSetupChart(@Body() dto: SaveSetupChartDto) {
    return this.setupChart.saveSetupChart(dto.symbol, dto.timeframe);
  }

  @Get('trade-chart/saved')
  @ApiOperation({ summary: 'List saved chart snapshots for a trade (by tradeKey)' })
  listSavedTradeCharts(@Query('tradeKey') tradeKey: string) {
    return this.setupChart.listSavedCharts(tradeKey?.trim() ?? '');
  }

  @Get('trade-chart/by-symbol')
  @ApiOperation({ summary: 'List all saved chart snapshots for one coin (by symbol)' })
  listSavedChartsBySymbol(@Query('symbol') symbol: string) {
    return this.setupChart.listSavedChartsBySymbol(symbol?.trim() ?? '');
  }

  /** Coerce the trade-chart image query string into typed params. */
  private parseTradeChartQuery(q: Record<string, string>): TradeChartParams {
    const num = (v: string | undefined) => Number(v);
    return {
      tradeKey: q.tradeKey ?? '',
      symbol: q.symbol ?? '',
      timeframe: q.timeframe ?? 'M30',
      holdSide: q.holdSide === 'short' ? 'short' : 'long',
      entryPrice: num(q.entryPrice),
      closePrice: num(q.closePrice),
      pnlUsd: num(q.pnlUsd),
      openedAt: num(q.openedAt),
      closedAt: num(q.closedAt),
    };
  }

  @Get('journal')
  @ApiOperation({ summary: 'List manual notes for one trade session (by tradeKey), oldest first' })
  listJournal(@Query('tradeKey') tradeKey: string) {
    return this.journal.list(tradeKey?.trim() ?? '');
  }

  @Post('journal')
  @ApiOperation({ summary: 'Add a manual note to a trade session' })
  createJournal(@Body() dto: CreateJournalDto) {
    return this.journal.create(dto);
  }

  @Put('journal/:id')
  @ApiOperation({ summary: 'Edit an existing trade note' })
  updateJournal(@Param('id') id: string, @Body() dto: UpdateJournalDto) {
    return this.journal.update(id, dto);
  }

  @Delete('journal/:id')
  @ApiOperation({ summary: 'Delete a trade note by id' })
  removeJournal(@Param('id') id: string) {
    return this.journal.remove(id);
  }
}
