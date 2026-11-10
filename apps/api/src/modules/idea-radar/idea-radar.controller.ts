import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { ZodError } from 'zod';

import { IdeaRadarService } from './idea-radar.service';
import { IdeaRadarStore } from './idea-radar.store';
import { IDEA_STATUSES, type IdeaStatus } from './types';

class RunDto {
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

class MarkIdeaDto {
  @IsIn(IDEA_STATUSES as unknown as string[]) status!: IdeaStatus;
}

/** /idea-radar page API — replaces the spec's CLI (run / ideas list / ideas mark / cost). */
@ApiTags('Idea Radar')
@ApiCookieAuth('market_analysis_session')
@Controller('idea-radar')
export class IdeaRadarController {
  constructor(
    private readonly service: IdeaRadarService,
    private readonly store: IdeaRadarStore,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Latest run (with report + ideas), recent runs, running flag' })
  async overview() {
    const [latest, runs] = await Promise.all([this.store.latestRun(), this.store.listRuns(12)]);
    return {
      running: this.service.isRunning,
      latest: latest ? { ...latest, ideas: await this.store.runIdeas(latest.id) } : null,
      runs,
    };
  }

  @Get('runs/:id')
  async run(@Param('id') id: string) {
    const run = await this.store.getRun(id);
    if (!run) throw new NotFoundException('Không tìm thấy lần chạy');
    return { ...run, ideas: await this.store.runIdeas(id) };
  }

  @Post('run')
  @ApiOperation({ summary: 'Start the pipeline now (background). dryRun = no Claude, no Telegram.' })
  start(@Body() body: RunDto) {
    return this.service.start('MANUAL', Boolean(body.dryRun));
  }

  @Get('ideas')
  ideas(@Query('status') status?: string) {
    if (status && !IDEA_STATUSES.includes(status as IdeaStatus)) throw new BadRequestException('status không hợp lệ');
    return this.store.listIdeas(status as IdeaStatus | undefined);
  }

  @Patch('ideas/:id')
  async mark(@Param('id') id: string, @Body() body: MarkIdeaDto) {
    try {
      return await this.store.markIdea(id, body.status);
    } catch {
      throw new NotFoundException('Không tìm thấy ý tưởng');
    }
  }

  @Get('cost')
  @ApiOperation({ summary: 'Claude cost estimate this month (SDK estimate; billed to the claude.ai plan)' })
  async cost() {
    const cfg = await this.service.getConfig();
    return { ...(await this.store.monthCost()), budgetUsd: cfg.llm.monthly_budget_usd };
  }

  @Get('config')
  config() {
    return this.service.getConfig();
  }

  @Put('config')
  async saveConfig(@Body() body: unknown) {
    try {
      return await this.service.setConfig(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
      throw err;
    }
  }
}
