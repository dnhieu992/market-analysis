import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
// Runtime class reference needed for Nest body metatype reflection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ChatRequestDto } from './dto/chat-request.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateConversationDto } from './dto/create-conversation.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SendMessageDto } from './dto/send-message.dto';
import type { ChatResponseDto } from './dto/chat-response.dto';

@ApiTags('Chat')
@ApiCookieAuth('market_analysis_session')
@Controller('chat')
export class ChatController {
  constructor(
    @Inject(ChatService)
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService
  ) {}

  // ── Legacy stateless endpoint ──────────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Stateless chat (no history saved)' })
  chat(@Body() body: ChatRequestDto): Promise<ChatResponseDto> {
    return this.chatService.chat(body);
  }

  // ── Conversations CRUD ─────────────────────────────────────────────
  @Get('conversations')
  @ApiOperation({ summary: 'List all conversations for the current user' })
  listConversations(@Req() req: AuthenticatedRequest) {
    return this.conversationService.listConversations(req.authUser!.id);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Create a new conversation' })
  createConversation(@Req() req: AuthenticatedRequest, @Body() body: CreateConversationDto) {
    return this.conversationService.createConversation(req.authUser!.id, body.title);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete a conversation' })
  deleteConversation(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.conversationService.deleteConversation(id, req.authUser!.id);
  }

  @Patch('conversations/:id/title')
  @ApiOperation({ summary: 'Update conversation title' })
  updateTitle(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { title: string }
  ) {
    return this.conversationService.updateTitle(id, req.authUser!.id, body.title);
  }

  // ── Messages ───────────────────────────────────────────────────────
  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get all messages in a conversation' })
  getMessages(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.conversationService.getConversationMessages(id, req.authUser!.id);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send a message and get AI reply' })
  sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: SendMessageDto
  ) {
    return this.conversationService.sendMessage(id, req.authUser!.id, body.content);
  }
}
