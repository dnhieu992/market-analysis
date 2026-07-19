import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class OrderJournalSnapshotDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() price?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() entryPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() pnlUsd?: number;
}

export class CreateOrderJournalDto {
  @ApiProperty({ example: 'clx123abc', description: 'Order id the note belongs to' })
  @IsString()
  @MaxLength(30)
  orderId!: string;

  @ApiProperty({ description: 'Markdown note content' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ type: [String], description: 'Cloudflare R2 image URLs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ type: OrderJournalSnapshotDto, description: 'Price/PnL snapshot at write time' })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderJournalSnapshotDto)
  snapshot?: OrderJournalSnapshotDto;
}
