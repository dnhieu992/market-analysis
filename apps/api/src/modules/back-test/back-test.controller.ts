import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { BackTestService } from './back-test.service';
import { RunBackTestDto } from './dto/run-back-test.dto';

@Controller('back-test')
export class BackTestController {
  constructor(private readonly backTestService: BackTestService) {}

  @Get('strategies')
  listStrategies() {
    return this.backTestService.listStrategies();
  }

  @Post('run')
  runBackTest(@Body() body: RunBackTestDto) {
    return this.backTestService.runBackTest(body);
  }

  @Get('results')
  listResults(
    @Query('strategy') strategy?: string,
    @Query('symbol') symbol?: string
  ) {
    return this.backTestService.listResults(strategy, symbol);
  }

  @Get('results/:id')
  getResult(@Param('id') id: string) {
    return this.backTestService.getResult(id);
  }
}
