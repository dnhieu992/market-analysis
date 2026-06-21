import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateNoteDto {
  // Markdown note. Empty string clears it; null also clears.
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  note?: string | null;
}
