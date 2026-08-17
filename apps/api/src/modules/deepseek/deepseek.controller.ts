import { Controller, Get, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DeepseekService } from './deepseek.service';

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

  @Post('agents/market-today')
  @ApiOperation({
    summary:
      'Run the "Market Today" agent: snapshot Binance 24h data, have DeepSeek write a Vietnamese market brief, return both',
  })
  runMarketToday() {
    return this.service.analyzeMarket();
  }
}
