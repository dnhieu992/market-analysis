import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString
} from 'class-validator';

export class CreateOrderDto {
  @IsString()
  symbol!: string;

  @IsString()
  @IsIn(['long', 'short'])
  side!: 'long' | 'short';

  @IsNumber()
  entryPrice!: number;

  @IsOptional()
  @IsNumber()
  stopLoss?: number;

  @IsOptional()
  @IsNumber()
  takeProfit?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  leverage?: number;

  @IsOptional()
  @IsString()
  exchange?: string;

  @IsOptional()
  @IsString()
  openedAt?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  signalId?: string;
}
