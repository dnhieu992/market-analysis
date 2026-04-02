import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CloseOrderDto {
  @IsNumber()
  closePrice!: number;

  @IsOptional()
  @IsString()
  closedAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
