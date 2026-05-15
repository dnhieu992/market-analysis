import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const SUPPORTED_DCA_COINS = ['BTC', 'ETH'] as const;
export type SupportedDcaCoin = typeof SUPPORTED_DCA_COINS[number];

export class CreateDcaConfigDto {
  @ApiProperty({ enum: SUPPORTED_DCA_COINS, example: 'BTC' })
  @IsIn(SUPPORTED_DCA_COINS)
  coin!: SupportedDcaCoin;

  @ApiProperty({ example: 3000 })
  @IsNumber()
  @Min(0)
  totalBudget!: number;

  @ApiPropertyOptional({ example: 'portfolio-uuid-here' })
  @IsOptional()
  @IsString()
  portfolioId?: string;

  @ApiPropertyOptional({ example: 'BTC DCA Portfolio 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  portfolioName?: string;
}
