import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateJunkCoinDto {
  @ApiProperty({ description: 'Note for the coin; empty string clears it' })
  @IsString()
  @MaxLength(5000)
  note!: string;
}
