import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddActivityLogDto {
  /** Markdown note. Empty is allowed when the note is images-only. */
  @IsString() @MaxLength(20000) content!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) images?: string[];
}

export class UpdateActivityLogDto {
  @IsOptional() @IsString() @MaxLength(20000) content?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) images?: string[];
}
