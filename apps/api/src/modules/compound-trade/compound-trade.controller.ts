import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { CompoundTradeService } from './compound-trade.service';
import { CreateCompoundTradeDto } from './dto/create-compound-trade.dto';
import { QueryCompoundTradesDto } from './dto/query-compound-trades.dto';
import { UpdateCompoundTradeDto } from './dto/update-compound-trade.dto';

@ApiTags('Compound Interest')
@ApiCookieAuth('market_analysis_session')
@Controller('compound-trades')
export class CompoundTradeController {
  constructor(
    @Inject(CompoundTradeService)
    private readonly service: CompoundTradeService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List compound trades for authenticated user' })
  list(@Req() req: AuthenticatedRequest, @Query() query: QueryCompoundTradesDto) {
    return this.service.listTrades(req.authUser!.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a compound trade' })
  create(@Req() req: AuthenticatedRequest, @Body() body: CreateCompoundTradeDto) {
    return this.service.createTrade(req.authUser!.id, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a compound trade' })
  update(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateCompoundTradeDto
  ) {
    return this.service.updateTrade(id, req.authUser!.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a compound trade' })
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.removeTrade(id, req.authUser!.id);
  }
}
