import { IsNumber, IsPositive } from 'class-validator';

export class FillOrderDto {
  @IsNumber() @IsPositive() fillPrice!: number;
}
