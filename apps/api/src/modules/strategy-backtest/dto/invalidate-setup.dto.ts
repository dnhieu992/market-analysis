import { IsOptional, IsString, MaxLength } from 'class-validator';

export class InvalidateSetupDto {
  /** Why the setup was called off. Optional — the trader is not always in the mood to explain. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
