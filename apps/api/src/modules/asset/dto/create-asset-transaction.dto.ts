import { IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateAssetTransactionDto {
  /** DEPOSIT = nạp lên sàn, WITHDRAW = rút khỏi sàn, TRANSFER = chuyển giữa 2 danh mục. */
  @IsIn(['DEPOSIT', 'WITHDRAW', 'TRANSFER'])
  type!: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER';

  @IsNumber()
  @IsPositive()
  amountUsdt!: number;

  /** Required for WITHDRAW and TRANSFER; must be absent for DEPOSIT. */
  @IsOptional()
  @IsString()
  fromCategoryId?: string;

  /** Required for DEPOSIT and TRANSFER; must be absent for WITHDRAW. */
  @IsOptional()
  @IsString()
  toCategoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Defaults to now when omitted. */
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
