import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddJunkCoinsDto {
  @ApiProperty({ example: ['ORDI', 'PIVXUSDT'], description: 'Coins to add — USDT is appended when missing' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  symbols!: string[];

  @ApiPropertyOptional({ description: 'Note applied to every added coin' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;
}
