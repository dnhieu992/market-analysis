import { Module } from '@nestjs/common';

import { OkxAiActionService } from './okx-ai-action.service';
import { OkxController } from './okx.controller';
import { OkxService } from './okx.service';
import { OkxShortSkillService } from './okx-short-skill.service';

/** OKX trading for the /trades short AI chat (the /trades order sync itself lives in the worker). */
@Module({
  controllers: [OkxController],
  providers: [OkxService, OkxAiActionService, OkxShortSkillService],
  // The chat tools (ChatModule) read the account and the skill through these.
  exports: [OkxService, OkxShortSkillService],
})
export class OkxModule {}
