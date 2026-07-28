import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

export class UpsertSymbolPriorityDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'MEXC symbol the priority applies to' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase MEXC symbol' })
  symbol!: string;

  @ApiProperty({ example: 3, description: 'Star rating, 0 (none) to 5 (max)' })
  @IsInt()
  @Min(0)
  @Max(5)
  priority!: number;
}
