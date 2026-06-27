import { IsNumber, IsOptional, IsPositive } from 'class-validator';

export class UpdateOrderDto {
  @IsOptional() @IsNumber() @IsPositive() plannedPrice?: number;
  @IsOptional() @IsNumber() @IsPositive() fillPrice?: number;
}
