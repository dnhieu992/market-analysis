import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CloseSetupDto } from './dto/close-setup.dto';
import { CreateSetupDto } from './dto/create-setup.dto';
import { InvalidateSetupDto } from './dto/invalidate-setup.dto';
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
  @ApiOperation({
    summary:
      'Edit a setup — prices only while it is still PENDING; note and review stay editable for life',
  })
  update(@Param('id') id: string, @Body() body: UpdateSetupDto) {
    return this.service.update(id, body);
  }

  // The only way a setup leaves the board. There is deliberately no DELETE route:
  // the trader keeps every plan ever written, abandoned ones included.
  @Post(':id/invalidate')
  @ApiOperation({ summary: 'Call a setup off with an optional reason — it stops being tracked and is left out of the stats' })
  invalidate(@Param('id') id: string, @Body() body: InvalidateSetupDto) {
    return this.service.invalidate(id, body);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close a filled setup by hand at a given (or the live) price' })
  close(@Param('id') id: string, @Body() body: CloseSetupDto) {
    return this.service.close(id, body);
  }
}
