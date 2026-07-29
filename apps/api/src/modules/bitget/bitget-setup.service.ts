import { BadRequestException, Injectable } from '@nestjs/common';
import {
  createBitgetSetupConfigRepository,
  createBitgetSymbolNoteRepository,
  createBitgetSymbolPriorityRepository,
} from '@app/db';

import type { BulkUpsertSetupConfigDto } from './dto/bulk-upsert-setup-config.dto';
import type { UpsertSetupConfigDto } from './dto/upsert-setup-config.dto';
import type { UpsertSymbolNoteDto } from './dto/upsert-symbol-note.dto';
import type { UpsertSymbolPriorityDto } from './dto/upsert-symbol-priority.dto';

export type BitgetSetupConfigDto = {
  symbol: string;
  holdSide: 'long' | 'short';
  leverage: number;
  marginUsd: number;
};

/** Manual 0–5 star rating a coin carries in the Setup tab. */
export type BitgetSymbolPriorityDto = {
  symbol: string;
  priority: number;
};

/** The trader's free-text assessment of one coin in the Setup tab. */
export type BitgetSymbolNoteDto = {
  symbol: string;
  note: string;
  updatedAt: string | null;
};

/** Highest star rating the UI (and this service) accepts. */
export const MAX_SYMBOL_PRIORITY = 5;

/** Guard against an accidental paste of a whole document into the note field. */
const MAX_NOTE_LENGTH = 20_000;

type SetupConfigRow = {
  symbol: string;
  holdSide: string;
  leverage: number;
  marginUsd: number;
};

type SymbolPriorityRow = {
  symbol: string;
  priority: number;
};

type SymbolNoteRow = {
  symbol: string;
  note: string;
  updatedAt: Date;
};

/**
 * Persistence for the /bitget Setup tab's per-coin, per-side open configs
 * (leverage + margin). Backed by the `bitget_setup_configs` table so the two
 * rows each coin shows (long/short) keep their settings across reloads instead
 * of living in the browser's localStorage.
 */
@Injectable()
export class BitgetSetupService {
  private readonly repo = createBitgetSetupConfigRepository();
  private readonly priorityRepo = createBitgetSymbolPriorityRepository();
  private readonly noteRepo = createBitgetSymbolNoteRepository();

  async list(): Promise<BitgetSetupConfigDto[]> {
    const rows = (await this.repo.findAll()) as SetupConfigRow[];
    return rows.map((r) => this.toDto(r));
  }

  async upsert(dto: UpsertSetupConfigDto): Promise<BitgetSetupConfigDto> {
    const holdSide = dto.holdSide === 'short' ? 'short' : 'long';
    if (!(dto.leverage >= 1 && dto.leverage <= 125)) {
      throw new BadRequestException('Đòn bẩy phải trong khoảng 1–125.');
    }
    if (!(dto.marginUsd >= 0)) {
      throw new BadRequestException('Ký quỹ không hợp lệ.');
    }
    const row = (await this.repo.upsert({
      symbol: dto.symbol.trim().toUpperCase(),
      holdSide,
      leverage: Math.round(dto.leverage),
      marginUsd: dto.marginUsd,
    })) as SetupConfigRow;
    return this.toDto(row);
  }

  /**
   * Overwrite the config of every `symbols × sides[].holdSide` pair in one
   * transaction, each side keeping its own leverage/margin. Duplicate symbols
   * and repeated sides are collapsed (last entry per side wins) so a sloppy
   * client payload can't fight itself inside the transaction.
   */
  async upsertMany(dto: BulkUpsertSetupConfigDto): Promise<BitgetSetupConfigDto[]> {
    const symbols = [...new Set(dto.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (symbols.length === 0) throw new BadRequestException('Chọn ít nhất 1 coin.');

    const bySide = new Map<'long' | 'short', { leverage: number; marginUsd: number }>();
    for (const side of dto.sides) {
      const holdSide = side.holdSide === 'short' ? 'short' : 'long';
      if (!(side.leverage >= 1 && side.leverage <= 125)) {
        throw new BadRequestException(
          `Đòn bẩy ${holdSide.toUpperCase()} phải trong khoảng 1–125.`,
        );
      }
      if (!(side.marginUsd >= 0)) {
        throw new BadRequestException(`Ký quỹ ${holdSide.toUpperCase()} không hợp lệ.`);
      }
      bySide.set(holdSide, { leverage: Math.round(side.leverage), marginUsd: side.marginUsd });
    }
    if (bySide.size === 0) throw new BadRequestException('Chọn ít nhất 1 hướng (Long/Short).');

    const inputs = symbols.flatMap((symbol) =>
      [...bySide.entries()].map(([holdSide, cfg]) => ({ symbol, holdSide, ...cfg })),
    );
    const rows = (await this.repo.upsertMany(inputs)) as SetupConfigRow[];
    return rows.map((r) => this.toDto(r));
  }

  /** Every coin's star priority (coins never rated simply have no row). */
  async listPriorities(): Promise<BitgetSymbolPriorityDto[]> {
    const rows = (await this.priorityRepo.findAll()) as SymbolPriorityRow[];
    return rows.map((r) => ({ symbol: r.symbol, priority: r.priority }));
  }

  /** Set one coin's star priority. 0 clears it (all stars grey in the tab). */
  async upsertPriority(dto: UpsertSymbolPriorityDto): Promise<BitgetSymbolPriorityDto> {
    const priority = Math.round(dto.priority);
    if (!(priority >= 0 && priority <= MAX_SYMBOL_PRIORITY)) {
      throw new BadRequestException(`Mức ưu tiên phải trong khoảng 0–${MAX_SYMBOL_PRIORITY} sao.`);
    }
    const row = (await this.priorityRepo.upsert({
      symbol: dto.symbol.trim().toUpperCase(),
      priority,
    })) as SymbolPriorityRow;
    return { symbol: row.symbol, priority: row.priority };
  }

  /** Every coin's assessment (coins never assessed simply have no row). */
  async listNotes(): Promise<BitgetSymbolNoteDto[]> {
    const rows = (await this.noteRepo.findAll()) as SymbolNoteRow[];
    return rows.map((r) => ({
      symbol: r.symbol,
      note: r.note,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /**
   * Save one coin's assessment. Clearing the text deletes the row rather than
   * storing an empty string, so "has a note" stays a simple row-exists check.
   */
  async upsertNote(dto: UpsertSymbolNoteDto): Promise<BitgetSymbolNoteDto> {
    const symbol = dto.symbol.trim().toUpperCase();
    const note = dto.note.trim();
    if (note.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException(`Đánh giá quá dài (tối đa ${MAX_NOTE_LENGTH} ký tự).`);
    }
    if (!note) {
      await this.noteRepo.remove(symbol);
      return { symbol, note: '', updatedAt: null };
    }
    const row = (await this.noteRepo.upsert({ symbol, note })) as SymbolNoteRow;
    return { symbol: row.symbol, note: row.note, updatedAt: row.updatedAt.toISOString() };
  }

  private toDto(row: SetupConfigRow): BitgetSetupConfigDto {
    return {
      symbol: row.symbol,
      holdSide: row.holdSide === 'short' ? 'short' : 'long',
      leverage: row.leverage,
      marginUsd: row.marginUsd,
    };
  }
}
