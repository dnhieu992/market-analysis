import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { CONVERSATION_REPOSITORY } from '../database/database.providers';
import { CHART_LAB_SKILL_ID } from './chart-lab.constants';
import { ChartLabService } from './chart-lab.service';

type ConversationRepo = ReturnType<typeof import('@app/db').createConversationRepository>;

export class CreateChartSampleDto {
  @IsString()
  @MaxLength(1000)
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageKey?: string;
}

export class UpdateChartSampleDto {
  @IsOptional() @IsString() @MaxLength(40) symbol?: string | null;
  @IsOptional() @IsString() @MaxLength(10) interval?: string | null;
  @IsOptional() @IsString() @MaxLength(40) chartTime?: string | null;
  @IsOptional() @IsIn(['LONG', 'SHORT', 'NONE', null]) direction?: 'LONG' | 'SHORT' | 'NONE' | null;
  @IsOptional() @IsNumber() tpPct?: number | null;
  @IsOptional() @IsNumber() slPct?: number | null;
  @IsOptional() @IsString() @MaxLength(5000) note?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) tags?: string[];
}

@ApiTags('Chart Lab')
@ApiCookieAuth('market_analysis_session')
@Controller('chart-lab')
export class ChartLabController {
  constructor(
    private readonly lab: ChartLabService,
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepo,
  ) {}

  @Get('samples')
  @ApiOperation({ summary: 'All chart samples, newest first' })
  list() {
    return this.lab.list();
  }

  @Post('samples')
  @ApiOperation({ summary: 'Add a chart (image already uploaded to R2): Claude reads it, pins it to its Binance candle, scores it (~10–20 s)' })
  create(@Body() body: CreateChartSampleDto) {
    return this.lab.create(body.imageUrl, body.imageKey);
  }

  @Get('samples/:id')
  get(@Param('id') id: string) {
    return this.lab.get(id);
  }

  @Patch('samples/:id')
  @ApiOperation({ summary: 'Edit label / tags / note / TP-SL, or fix coin-timeframe-time (re-pins + re-scores)' })
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

  @Post('samples/:id/conversation')
  @ApiOperation({ summary: 'The analysis chat of a chart (created on first use)' })
  async conversation(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const s = await this.lab.get(id);
    if (s.conversationId) {
      const existing = await this.convRepo.findById(s.conversationId);
      if (existing) return { conversationId: existing.id };
    }
    const title = `Chart ${s.symbol ?? '?'} ${s.interval ?? ''}`.trim();
    const conv = await this.convRepo.create(req.authUser!.id, title, CHART_LAB_SKILL_ID, { sampleId: id });
    await this.lab.setConversation(id, conv.id);
    return { conversationId: conv.id };
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
