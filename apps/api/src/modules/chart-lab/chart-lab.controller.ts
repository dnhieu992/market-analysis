import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

import { ChartLabService } from './chart-lab.service';

export class UpdateChartSampleDto {
  @IsOptional() @IsString() @MaxLength(40) symbol?: string | null;
  @IsOptional() @IsString() @MaxLength(10) interval?: string | null;
  @IsOptional() @IsString() @MaxLength(40) chartTime?: string | null;
  @IsOptional() @IsIn(['LONG', 'SHORT', 'NONE', null]) direction?: 'LONG' | 'SHORT' | 'NONE' | null;
  @IsOptional() @IsNumber() entryPrice?: number | null;
  @IsOptional() @IsNumber() tpPrice?: number | null;
  @IsOptional() @IsNumber() slPrice?: number | null;
  @IsOptional() @IsString() @MaxLength(10000) note?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) tags?: string[];
}

export class CreateChartSampleDto extends UpdateChartSampleDto {
  @IsString()
  @MaxLength(1000)
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageKey?: string;
}

/** /chart-lab CRUD — no AI here (Analyze lives in the chat module: ChartLabAnalyzeController). */
@ApiTags('Chart Lab')
@ApiCookieAuth('market_analysis_session')
@Controller('chart-lab')
export class ChartLabController {
  constructor(private readonly lab: ChartLabService) {}

  @Get('samples')
  @ApiOperation({ summary: 'All charts, newest first' })
  list() {
    return this.lab.list();
  }

  @Post('samples')
  @ApiOperation({ summary: 'Save a chart (image already in R2) with the user’s analysis; pins it to its Binance candle and scores it. No AI.' })
  create(@Body() body: CreateChartSampleDto) {
    const { imageUrl, imageKey, ...input } = body;
    return this.lab.create(imageUrl, imageKey, input);
  }

  @Get('samples/:id')
  get(@Param('id') id: string) {
    return this.lab.get(id);
  }

  @Patch('samples/:id')
  @ApiOperation({ summary: 'Edit the user’s analysis; coin / timeframe / time / prices changes re-score the chart' })
  update(@Param('id') id: string, @Body() body: UpdateChartSampleDto) {
    return this.lab.update(id, body);
  }

  @Delete('samples/:id')
  remove(@Param('id') id: string) {
    return this.lab.remove(id);
  }

  @Get('samples/:id/similar')
  @ApiOperation({ summary: 'Most similar charts in the library (market fingerprint + shared tags)' })
  similar(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.lab.similar(id, limit ? Number(limit) : 5);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Win rates of the user’s LONG/SHORT calls: overall, per direction, per tag' })
  stats() {
    return this.lab.stats();
  }

  @Get('tags')
  tags() {
    return this.lab.tags();
  }
}
