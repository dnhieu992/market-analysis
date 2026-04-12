import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { BackTestService } from './back-test.service';
import { RunBackTestDto } from './dto/run-back-test.dto';

@ApiTags('Back-Test')
@ApiCookieAuth('market_analysis_session')
@Controller('back-test')
export class BackTestController {
  constructor(private readonly backTestService: BackTestService) {}

  @Get('strategies')
  @ApiOperation({ summary: 'List all available back-test strategies' })
  listStrategies() {
    return this.backTestService.listStrategies();
  }

  @Post('run')
  @ApiOperation({ summary: 'Run a back-test for a given strategy, symbol and date range' })
  runBackTest(@Body() body: RunBackTestDto) {
    return this.backTestService.runBackTest(body);
  }

  @Get('results')
  @ApiOperation({ summary: 'List past back-test results' })
  listResults(
    @Query('strategy') strategy?: string,
    @Query('symbol') symbol?: string
  ) {
    return this.backTestService.listResults(strategy, symbol);
  }

  @Get('results/:id')
  @ApiOperation({ summary: 'Get a back-test result by ID' })
  getResult(@Param('id') id: string) {
    return this.backTestService.getResult(id);
  }

  @Delete('results/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a back-test result by ID' })
  deleteResult(@Param('id') id: string) {
    return this.backTestService.deleteResult(id);
  }
}
