import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Min } from 'class-validator';

export class CreateDcaConfigDto {
  @ApiProperty({ enum: ['BTC', 'ETH'], example: 'BTC' })
  @IsIn(['BTC', 'ETH'])
  coin!: 'BTC' | 'ETH';

  @ApiProperty({ example: 3000 })
  @IsNumber()
  @Min(0)
  totalBudget!: number;

  @ApiProperty({ example: 'portfolio-uuid-here' })
  @IsString()
  portfolioId!: string;
}
