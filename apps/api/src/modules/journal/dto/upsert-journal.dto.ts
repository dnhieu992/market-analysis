import { ArrayMaxSize, IsArray, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertJournalDto {
  /** Calendar day of the entry, ISO date (YYYY-MM-DD). One journal per day. */
  @IsISO8601()
  date!: string;

  @IsString()
  content!: string;

  /** Cloudflare R2 image URLs (uploaded separately via POST /upload/images). */
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  images?: string[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @ArrayMaxSize(30)
  tags?: string[];
}
