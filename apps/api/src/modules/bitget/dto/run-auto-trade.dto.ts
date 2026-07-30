import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class RunAutoTradeDto {
  @ApiProperty({
    enum: ['entry', 'review'],
    description:
      'Which pass to run right now against the LIVE account: `entry` = the 00:00 UTC opening pass, ' +
      '`review` = the 09:00 UTC close/extend pass',
  })
  @IsIn(['entry', 'review'])
  phase!: 'entry' | 'review';
}
