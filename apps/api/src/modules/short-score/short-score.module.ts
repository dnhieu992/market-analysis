import { Module } from '@nestjs/common';

import { BacktestLabModule } from '../backtest-lab/backtest-lab.module';
import { ShortScoreController } from './short-score.controller';
import { ShortScoreService } from './short-score.service';

/** BTC SHORT checklist score of the /trades OKX chat (criteria editable from the chat, daily cron). */
@Module({
  imports: [BacktestLabModule],
  controllers: [ShortScoreController],
  providers: [ShortScoreService],
  exports: [ShortScoreService],
})
export class ShortScoreModule {}
