import { Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { CHART_LAB_ANALYZE_PROMPT, CHART_LAB_SKILL_ID } from '../chart-lab/chart-lab.constants';
import { ChartLabService } from '../chart-lab/chart-lab.service';
import { CONVERSATION_REPOSITORY } from '../database/database.providers';
import { ConversationService } from './conversation.service';

type ConversationRepo = ReturnType<typeof import('@app/db').createConversationRepository>;

/** The only place /chart-lab calls Claude: the user clicks Analyze (or asks a follow-up in that chart's chat). */
@ApiTags('Chart Lab')
@ApiCookieAuth('market_analysis_session')
@Controller('chart-lab/samples/:id')
export class ChartLabAnalyzeController {
  constructor(
    private readonly lab: ChartLabService,
    private readonly conversations: ConversationService,
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepo,
  ) {}

  @Post('analyze')
  @ApiOperation({ summary: 'Ask Claude to evaluate the user’s analysis and analyze the chart (runs in background; poll the conversation)' })
  async analyze(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const conversationId = await this.ensureConversation(req.authUser!.id, id);
    await this.conversations.sendMessage(conversationId, req.authUser!.id, CHART_LAB_ANALYZE_PROMPT);
    return { conversationId };
  }

  @Post('conversation')
  @ApiOperation({ summary: 'The chart’s Claude thread (created on first use) — for follow-up questions' })
  async conversation(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return { conversationId: await this.ensureConversation(req.authUser!.id, id) };
  }

  private async ensureConversation(userId: string, id: string): Promise<string> {
    const s = await this.lab.get(id);
    if (s.conversationId) {
      const existing = await this.convRepo.findById(s.conversationId);
      if (existing) return existing.id;
    }
    const conv = await this.convRepo.create(userId, `Chart ${s.symbol ?? '?'} ${s.interval ?? ''}`.trim(), CHART_LAB_SKILL_ID, { sampleId: id });
    await this.lab.setConversation(id, conv.id);
    return conv.id;
  }
}
