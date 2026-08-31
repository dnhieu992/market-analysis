import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CloseSetupDto } from './dto/close-setup.dto';
import { CreateSetupDto } from './dto/create-setup.dto';
import { UpdateSetupDto } from './dto/update-setup.dto';
import { StrategyBacktestService } from './strategy-backtest.service';

@ApiTags('Strategy Backtest')
@ApiCookieAuth('market_analysis_session')
@Controller('strategy-backtest')
export class StrategyBacktestController {
  constructor(
    @Inject(StrategyBacktestService)
    private readonly service: StrategyBacktestService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List every tracked setup plus the live price of the symbol' })
  list() {
    return this.service.list();
  }

  @Post()
  @ApiOperation({ summary: 'Add a manual setup — it starts PENDING until price fills it' })
  create(@Body() body: CreateSetupDto) {
    return this.service.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a setup (prices only while it is still PENDING)' })
  update(@Param('id') id: string, @Body() body: UpdateSetupDto) {
    return this.service.update(id, body);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a setup that has not filled yet' })
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close a filled setup by hand at a given (or the live) price' })
  close(@Param('id') id: string, @Body() body: CloseSetupDto) {
    return this.service.close(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a setup and its result permanently' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
