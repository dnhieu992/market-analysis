import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTrackedSetupNotesDto {
  @IsOptional() @IsString() @MaxLength(20000) notes?: string | null;
}
