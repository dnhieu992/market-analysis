import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import type { PatternKind } from '@app/core';

const PATTERNS: PatternKind[] = ['double_bottom', 'double_top', 'head_shoulders', 'inverse_head_shoulders'];
const TIMEFRAMES = ['1d', '4h', '1w', '1h'] as const;

export class ScanDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(PATTERNS, { each: true })
  patterns!: PatternKind[];

  @IsOptional()
  @IsString()
  @IsIn(TIMEFRAMES)
  timeframe?: (typeof TIMEFRAMES)[number];
}
