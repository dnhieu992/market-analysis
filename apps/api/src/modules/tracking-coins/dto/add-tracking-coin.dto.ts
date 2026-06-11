import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddTrackingCoinDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  symbol!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;
}
