import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DcaLadderSyncService } from './dca-ladder.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [DcaLadderSyncService],
  exports: [DcaLadderSyncService],
})
export class DcaLadderModule {}
