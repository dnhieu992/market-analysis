import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Cancel one pending (unfilled) limit order by its exchange order id. */
export class CancelOrderDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'Bitget symbol of the pending order' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ example: '1234567890', description: 'Exchange order id to cancel' })
  @IsString()
  @Matches(/^[0-9]{1,32}$/, { message: 'orderId must be a numeric Bitget order id' })
  orderId!: string;
}
