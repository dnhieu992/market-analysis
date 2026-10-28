import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Matches, Max, Min } from 'class-validator';

/** Close part of a live position at market (closing-side order on that positionId). */
export class ClosePartialDto {
  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase MEXC symbol' })
  symbol!: string;

  @ApiProperty({ enum: ['long', 'short'] })
  @IsIn(['long', 'short'])
  holdSide!: 'long' | 'short';

  @ApiProperty({ example: 50, description: '% of the position to close (100 = all)' })
  @IsNumber()
  @Min(1)
  @Max(100)
  pct!: number;
}
