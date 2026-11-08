import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiCookieAuth('market_analysis_session')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Notifications, newest first (cursor-paged). Filters: unread=1, exchange=bitget|mexc' })
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('unread') unread?: string,
    @Query('exchange') exchange?: string,
  ) {
    const n = limit ? Number(limit) : undefined;
    return this.notifications.list({
      cursor: cursor || undefined,
      limit: n != null && Number.isFinite(n) ? n : undefined,
      unreadOnly: unread === '1' || unread === 'true',
      exchange: exchange === 'bitget' || exchange === 'mexc' ? exchange : undefined,
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications (sidebar badge)' })
  unreadCount() {
    return this.notifications.unreadCount();
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark every notification read' })
  markAllRead() {
    return this.notifications.markAllRead();
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }
}
