import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OkxAiActionService } from './okx-ai-action.service';
import { OkxService } from './okx.service';
import { OkxShortSkillService } from './okx-short-skill.service';
// Runtime class references needed for Nest body metatype reflection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ExecuteAiActionDto } from './dto/execute-ai-action.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UpdateShortSkillDto } from './dto/update-short-skill.dto';

@ApiTags('OKX')
@ApiCookieAuth('market_analysis_session')
@Controller('okx')
export class OkxController {
  constructor(
    private readonly okx: OkxService,
    private readonly aiActions: OkxAiActionService,
    private readonly skill: OkxShortSkillService,
  ) {}

  @Get('account')
  @ApiOperation({ summary: 'Live OKX SWAP account: positions (with TP), equity, available, margin in use' })
  account() {
    return this.okx.getAccount();
  }

  @Get('pending')
  @ApiOperation({ summary: 'Resting (unfilled) OKX SWAP orders — the "Lệnh limit đang chờ" panel of /trades' })
  async pending() {
    const fetchedAt = new Date().toISOString();
    if (!this.okx.isConfigured()) return { configured: false, orders: [], fetchedAt };
    return { configured: true, orders: await this.okx.listPendingOrders(), fetchedAt };
  }

  @Get('ai/actions')
  @ApiOperation({ summary: 'Action cards the /trades OKX short AI chat proposed in one conversation' })
  listAiActions(@Query('conversationId') conversationId: string) {
    return this.aiActions.list(conversationId?.trim() ?? '');
  }

  @Post('ai/actions/:id/execute')
  @ApiOperation({ summary: 'Run one AI-proposed SHORT action on the LIVE OKX account after the user confirmed it' })
  executeAiAction(@Param('id') id: string, @Body() dto: ExecuteAiActionDto) {
    return this.aiActions.execute(id, dto);
  }

  @Post('ai/actions/:id/dismiss')
  @ApiOperation({ summary: 'Mark an AI-proposed action as skipped' })
  dismissAiAction(@Param('id') id: string) {
    return this.aiActions.dismiss(id);
  }

  @Get('ai/skill')
  @ApiOperation({ summary: 'Current editable analysis skill of the OKX short chat + version history' })
  getSkill() {
    return this.skill.get();
  }

  @Get('ai/skill/versions/:version')
  @ApiOperation({ summary: 'One saved version of the analysis skill' })
  getSkillVersion(@Param('version', ParseIntPipe) version: number) {
    return this.skill.getVersion(version);
  }

  @Put('ai/skill')
  @ApiOperation({ summary: 'Save a new version of the analysis skill (applies to the next chat message)' })
  updateSkill(@Body() dto: UpdateShortSkillDto) {
    return this.skill.update(dto.content, dto.note ?? null, 'USER');
  }

  @Post('ai/skill/versions/:version/restore')
  @ApiOperation({ summary: 'Restore an old version (written as a new version)' })
  restoreSkill(@Param('version', ParseIntPipe) version: number) {
    return this.skill.rollback(version);
  }
}
