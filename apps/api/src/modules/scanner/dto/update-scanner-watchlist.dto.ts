import { IsArray, IsString } from 'class-validator';

export class UpdateScannerWatchlistDto {
  @IsArray()
  @IsString({ each: true })
  symbols!: string[];
}
