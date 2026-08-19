import { BadRequestException, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DeepseekService } from './deepseek.service';

/** `YYYY-MM-DD`, the Vietnam calendar day a stored analysis is keyed by. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

@ApiTags('deepseek')
@ApiCookieAuth('market_analysis_session')
@Controller('deepseek')
export class DeepseekController {
  constructor(private readonly service: DeepseekService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Whether DEEPSEEK_API_KEY is configured, and which model the agents would use',
  })
  getStatus() {
    return this.service.status();
  }

  @Post('agents/btc-daytrade')
  @ApiOperation({
    summary:
      'Run the BTC day-trading agent: snapshot BTCUSDT price action across 1D/4H/1H/15m (structure, trend lines, Fibonacci), have DeepSeek return one intraday setup, verify the trade geometry, render the 4H+15m chart, and store the result as today\'s record (re-running the same day overwrites it)',
  })
  runBtcDaytrade() {
    return this.service.analyzeBtcDaytrade();
  }

  // `today` and `history` are declared before `:date` — Nest matches routes in
  // declaration order, so a param route above them would swallow both.
  @Get('agents/btc-daytrade/today')
  @ApiOperation({ summary: "Today's stored analysis (Vietnam time), or null before the first run" })
  getToday() {
    return this.service.today();
  }

  @Get('agents/btc-daytrade/history')
  @ApiOperation({ summary: 'Recent stored analyses, newest first (no snapshot/markdown payload)' })
  getHistory(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.service.history(Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 90) : undefined);
  }

  @Get('agents/btc-daytrade/:date')
  @ApiOperation({ summary: 'One stored analysis by Vietnam calendar day (YYYY-MM-DD), or null' })
  getByDate(@Param('date') date: string) {
    if (!DATE_KEY.test(date)) {
      throw new BadRequestException('Ngày phải có dạng YYYY-MM-DD.');
    }
    return this.service.byDate(date);
  }
}
