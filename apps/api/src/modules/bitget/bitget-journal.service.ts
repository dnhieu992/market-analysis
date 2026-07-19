import { Injectable, NotFoundException } from '@nestjs/common';
import {
  createBitgetTradeJournalRepository,
  type BitgetTradeJournalSnapshot,
} from '@app/db';

import type { CreateJournalDto } from './dto/create-journal.dto';
import type { UpdateJournalDto } from './dto/update-journal.dto';

export type BitgetJournalNoteDto = {
  id: string;
  tradeKey: string;
  symbol: string;
  holdSide: 'long' | 'short';
  content: string;
  images: string[];
  snapshot: BitgetTradeJournalSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

type JournalRow = {
  id: string;
  tradeKey: string;
  symbol: string;
  holdSide: string;
  content: string;
  images: unknown;
  snapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Manual per-trade note timeline for a live Bitget position. Notes are grouped by
 * `tradeKey` (symbol-holdSide-openedAt) so each trade session keeps its own log.
 * Markdown reformatting is done client-side via the shared /journal/reformat
 * endpoint before the note is posted here — this service just persists.
 */
@Injectable()
export class BitgetJournalService {
  private readonly repo = createBitgetTradeJournalRepository();

  private map(r: JournalRow): BitgetJournalNoteDto {
    return {
      id: r.id,
      tradeKey: r.tradeKey,
      symbol: r.symbol,
      holdSide: r.holdSide === 'short' ? 'short' : 'long',
      content: r.content,
      images: toStringArray(r.images),
      snapshot: (r.snapshot as BitgetTradeJournalSnapshot | null) ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /** All notes for one trade session, oldest first. */
  async list(tradeKey: string): Promise<BitgetJournalNoteDto[]> {
    const rows = await this.repo.findByTradeKey(tradeKey);
    return rows.map((r) => this.map(r));
  }

  async create(input: CreateJournalDto): Promise<BitgetJournalNoteDto> {
    const row = await this.repo.create({
      tradeKey: input.tradeKey,
      symbol: input.symbol,
      holdSide: input.holdSide,
      content: input.content,
      images: input.images ?? [],
      snapshot: input.snapshot ?? null,
    });
    return this.map(row);
  }

  async update(id: string, input: UpdateJournalDto): Promise<BitgetJournalNoteDto> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Journal note ${id} not found`);
    const row = await this.repo.update(id, { content: input.content, images: input.images ?? [] });
    return this.map(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Journal note ${id} not found`);
    await this.repo.deleteById(id);
  }
}
