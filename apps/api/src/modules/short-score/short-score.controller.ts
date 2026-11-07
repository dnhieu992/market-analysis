import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ShortScoreService } from './short-score.service';

@ApiTags('OKX')
@ApiCookieAuth('market_analysis_session')
@Controller('okx/ai/score')
export class ShortScoreController {
  constructor(private readonly score: ShortScoreService) {}

  @Get()
  @ApiOperation({ summary: 'Latest SHORT score snapshot (BTC checklist of the /trades OKX chat) + recent scores' })
  async latest() {
    const [latest, recent, criteria] = await Promise.all([this.score.latest(), this.score.recent(14), this.score.criteria()]);
    return { latest, recent, criteriaVersion: criteria.version, criteriaCount: criteria.set.criteria.filter((c) => c.enabled !== false).length };
  }

  @Post('run')
  @ApiOperation({ summary: 'Score now with the current criteria set (runs in the sandbox, ~2–5 s) and store it' })
  run() {
    return this.score.scoreNow('UI');
  }

  @Get('criteria')
  @ApiOperation({ summary: 'Current criteria set (JSON) + version history' })
  async criteria() {
    const [cur, history] = await Promise.all([this.score.criteria(), this.score.history()]);
    return { ...cur, history };
  }

  @Post('criteria/versions/:version/restore')
  @ApiOperation({ summary: 'Restore an old criteria set as a new version' })
  restore(@Param('version', ParseIntPipe) version: number) {
    return this.score.rollback(version);
  }

  @Get('backtest')
  @ApiOperation({ summary: 'Backtest the current criteria set: daily score vs which of ±m% was touched first' })
  backtest(@Query('days') days?: string, @Query('hourVn') hourVn?: string) {
    return this.score.backtest({ days: days ? Number(days) : undefined, hourVn: hourVn ? Number(hourVn) : undefined });
  }
}
