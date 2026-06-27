import { Module } from '@nestjs/common';
import { DcaLadderController } from './dca-ladder.controller';
import { DcaLadderService } from './dca-ladder.service';

@Module({
  controllers: [DcaLadderController],
  providers: [DcaLadderService],
  exports: [DcaLadderService],
})
export class DcaLadderModule {}
