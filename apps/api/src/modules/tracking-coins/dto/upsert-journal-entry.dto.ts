import { IsDateString, IsString } from 'class-validator';

export class UpsertJournalEntryDto {
  @IsDateString()
  date!: string;

  @IsString()
  content!: string;
}
