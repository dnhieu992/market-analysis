import { IsString, MaxLength } from 'class-validator';

export class ReformatJournalDto {
  /** Raw journal markdown to clean up / reformat. */
  @IsString()
  @MaxLength(20000)
  content!: string;
}
