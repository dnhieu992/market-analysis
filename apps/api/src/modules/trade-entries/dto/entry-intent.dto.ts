import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Optional "why" fields any order-placing DTO can extend: which entry strategy
 * the trader is following, its grade, a free-text reason and tags. Stored on
 * `trade_entries` and summarised in the trade journal ("🧭 Lý do vào lệnh").
 */
export class EntryIntentDto {
  @ApiPropertyOptional({ example: 'qqe-pullback-swing', description: 'Entry strategy key (ENTRY_STRATEGIES in @app/core)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  strategyKey?: string;

  @ApiPropertyOptional({ example: 'A', description: 'Grade within the strategy (A / B / strong / normal / hedge)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  grade?: string;

  @ApiPropertyOptional({ enum: ['SWING', 'SCALP', 'HEDGE', 'OTHER'] })
  @IsOptional()
  @IsIn(['SWING', 'SCALP', 'HEDGE', 'OTHER'])
  mode?: 'SWING' | 'SCALP' | 'HEDGE' | 'OTHER';

  @ApiPropertyOptional({ description: 'Why this entry — free text (Vietnamese)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({ type: [String], example: ['fomo', 'tin-tuc'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}

/** The intent fields of an order DTO, tagged with where the order came from. */
export function entryFromDto(
  dto: EntryIntentDto,
  source: 'SETUP_TAB' | 'AI_CARD' | 'AUTO' = 'SETUP_TAB',
): {
  source: 'SETUP_TAB' | 'AI_CARD' | 'AUTO';
  strategyKey?: string;
  grade?: string;
  mode?: string;
  reason?: string;
  tags?: string[];
} {
  return { source, strategyKey: dto.strategyKey, grade: dto.grade, mode: dto.mode, reason: dto.reason, tags: dto.tags };
}
