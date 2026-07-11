import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AddWatchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  symbol!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
