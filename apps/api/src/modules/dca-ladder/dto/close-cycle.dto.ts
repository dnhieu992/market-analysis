import { IsNumber, IsPositive } from 'class-validator';

export class CloseCycleDto {
  @IsNumber() @IsPositive() sellPrice!: number;
}
