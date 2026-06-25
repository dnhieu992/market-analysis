import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddCoinDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  symbol!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;
}
