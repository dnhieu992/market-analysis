import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { StrategiesService } from './strategies.service';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';

@ApiTags('Strategies')
@ApiCookieAuth('market_analysis_session')
@Controller('strategies')
export class StrategiesController {
  constructor(
    @Inject(StrategiesService)
    private readonly strategiesService: StrategiesService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all strategies' })
  listStrategies() {
    return this.strategiesService.listStrategies();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a strategy by ID' })
  getStrategyById(@Param('id') id: string) {
    return this.strategiesService.getStrategyById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new strategy' })
  createStrategy(@Body() body: CreateStrategyDto) {
    return this.strategiesService.createStrategy(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a strategy' })
  updateStrategy(@Param('id') id: string, @Body() body: UpdateStrategyDto) {
    return this.strategiesService.updateStrategy(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a strategy' })
  removeStrategy(@Param('id') id: string) {
    return this.strategiesService.removeStrategy(id);
  }
}
