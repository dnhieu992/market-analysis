import { IsNumber, IsOptional, IsPositive } from 'class-validator';

export class CloseSetupDto {
  /** Manual exit price. Omitted → the API closes at the live market price. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  exitPrice?: number;
}
