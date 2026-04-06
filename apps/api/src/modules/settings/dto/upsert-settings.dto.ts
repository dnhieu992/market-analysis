import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class UpsertSettingsDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  @IsString({ each: true })
  trackingSymbols!: string[];
}
