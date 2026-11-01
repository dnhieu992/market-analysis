import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MaxLength(128)
  newPassword!: string;

  @ApiProperty({ description: '6-digit TOTP code or a backup code' })
  @IsString()
  @MaxLength(32)
  code!: string;
}

export class TotpCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @MaxLength(32)
  code!: string;
}
