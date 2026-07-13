import { IsString, MaxLength, IsOptional } from 'class-validator';

export class UploadReferenceDto {
  @IsString()
  @MaxLength(30)
  pattern!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
