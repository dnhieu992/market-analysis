import { Module } from '@nestjs/common';

import { ChatModule } from '../chat/chat.module';
import { IdeaRadarController } from './idea-radar.controller';
import { IdeaRadarService } from './idea-radar.service';
import { IdeaRadarStore } from './idea-radar.store';

@Module({
  imports: [ChatModule],
  controllers: [IdeaRadarController],
  providers: [IdeaRadarService, IdeaRadarStore],
})
export class IdeaRadarModule {}
