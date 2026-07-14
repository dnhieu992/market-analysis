import { Injectable, NotFoundException } from '@nestjs/common';
import { createTradingJournalRepository } from '@app/db';

export type JournalEntryDto = {
  id: string;
  date: string; // ISO date YYYY-MM-DD
  content: string;
  images: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** Coerce a Prisma Json column (unknown at the type level) to a string[]. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** Parse an ISO date (YYYY-MM-DD) to a UTC-midnight Date for the @db.Date column. */
function toDateOnly(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

type JournalRow = {
  id: string;
  date: Date;
  content: string;
  images: unknown;
  tags: unknown;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class JournalService {
  private readonly repo = createTradingJournalRepository();

  private map(r: JournalRow): JournalEntryDto {
    return {
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      content: r.content,
      images: toStringArray(r.images),
      tags: toStringArray(r.tags),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async list(): Promise<JournalEntryDto[]> {
    const rows = await this.repo.findAll();
    return rows.map((r) => this.map(r));
  }

  async getByDate(date: string): Promise<JournalEntryDto | null> {
    const row = await this.repo.findByDate(toDateOnly(date));
    return row ? this.map(row) : null;
  }

  /** Create or update the entry for a calendar day. */
  async upsert(input: { date: string; content: string; images?: string[]; tags?: string[] }): Promise<JournalEntryDto> {
    const row = await this.repo.upsertByDate({
      date: toDateOnly(input.date),
      content: input.content,
      images: input.images ?? [],
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
    });
    return this.map(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Journal entry ${id} not found`);
    await this.repo.deleteById(id);
  }
}
