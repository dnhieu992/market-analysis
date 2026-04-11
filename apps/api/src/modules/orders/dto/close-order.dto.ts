import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CloseOrderDto {
  @ApiProperty({ example: 86000 })
  @IsNumber()
  closePrice!: number;

  @ApiPropertyOptional({ example: '2024-06-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  closedAt?: string;

  @ApiPropertyOptional({ example: 'TP hit' })
  @IsOptional()
  @IsString()
  note?: string;
}
