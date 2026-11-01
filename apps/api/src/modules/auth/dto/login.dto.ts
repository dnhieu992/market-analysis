import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'password123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

/** Any step after the password: carries the short-lived login challenge. */
export class LoginChallengeDto {
  @ApiProperty({ description: 'Challenge token from the previous login step' })
  @IsString()
  @MaxLength(128)
  challenge!: string;
}

export class LoginNewPasswordDto extends LoginChallengeDto {
  @ApiProperty({ minLength: 10 })
  @IsString()
  @MaxLength(128)
  newPassword!: string;
}

export class LoginCodeDto extends LoginChallengeDto {
  @ApiProperty({ example: '123456', description: '6-digit TOTP code or a backup code' })
  @IsString()
  @MaxLength(32)
  code!: string;

  @ApiPropertyOptional({ description: 'Remember this browser for 30 days' })
  @IsOptional()
  @IsBoolean()
  trustDevice?: boolean;
}
