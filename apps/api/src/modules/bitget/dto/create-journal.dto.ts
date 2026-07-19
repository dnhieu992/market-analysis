import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class JournalSnapshotDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() markPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() entryPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() roePct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() unrealizedPnlUsd?: number;
}

export class CreateJournalDto {
  @ApiProperty({ example: 'BTCUSDT-long-1721300000000', description: 'Trade session key (symbol-holdSide-openedAt)' })
  @IsString()
  @MaxLength(90)
  tradeKey!: string;

  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ enum: ['long', 'short'] })
  @IsIn(['long', 'short'])
  holdSide!: 'long' | 'short';

  @ApiProperty({ description: 'Markdown note content' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ type: [String], description: 'Cloudflare R2 image URLs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ type: JournalSnapshotDto, description: 'Price/PnL snapshot at write time' })
  @IsOptional()
  @ValidateNested()
  @Type(() => JournalSnapshotDto)
  snapshot?: JournalSnapshotDto;
}
