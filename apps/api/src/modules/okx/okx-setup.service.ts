import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  createOkxSetupConfigRepository,
  createOkxSymbolPriorityRepository,
  createOkxWatchlistRepository,
} from '@app/db';

import type { AddWatchlistSymbolDto } from './dto/add-watchlist-symbol.dto';
import type { BulkUpsertSetupConfigDto } from './dto/bulk-upsert-setup-config.dto';
import type { UpsertSetupConfigDto } from './dto/upsert-setup-config.dto';
import type { UpsertSymbolPriorityDto } from './dto/upsert-symbol-priority.dto';
import { OkxTradeClient } from './okx-trade.client';

export type OkxSetupConfigDto = {
  symbol: string;
  holdSide: 'long' | 'short';
  leverage: number;
  marginUsd: number;
};

/** Manual 0–5 star rating a coin carries in the Setup tab. */
export type OkxSymbolPriorityDto = {
  symbol: string;
  priority: number;
};

/** One coin the trader added to the Setup tab by hand. */
export type OkxWatchlistSymbolDto = {
  symbol: string;
  createdAt: string;
};

/** Highest star rating the UI (and this service) accepts. */
export const MAX_SYMBOL_PRIORITY = 5;

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

type WatchlistRow = {
  symbol: string;
  createdAt: Date;
};

/**
 * Persistence for the /okx Setup tab's per-coin, per-side open configs
 * (leverage + margin). Backed by the `okx_setup_configs` table so the two
 * rows each coin shows (long/short) keep their settings across reloads instead
 * of living in the browser's localStorage.
 */
@Injectable()
export class OkxSetupService {
  private readonly repo = createOkxSetupConfigRepository();
  private readonly priorityRepo = createOkxSymbolPriorityRepository();
  private readonly watchlistRepo = createOkxWatchlistRepository();
  /** Only used for the public `contract/detail` lookup that validates a new coin. */
  private readonly client = new OkxTradeClient();

  async list(): Promise<OkxSetupConfigDto[]> {
    const rows = (await this.repo.findAll()) as SetupConfigRow[];
    return rows.map((r) => this.toDto(r));
  }

  async upsert(dto: UpsertSetupConfigDto): Promise<OkxSetupConfigDto> {
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
  async upsertMany(dto: BulkUpsertSetupConfigDto): Promise<OkxSetupConfigDto[]> {
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
  async listPriorities(): Promise<OkxSymbolPriorityDto[]> {
    const rows = (await this.priorityRepo.findAll()) as SymbolPriorityRow[];
    return rows.map((r) => ({ symbol: r.symbol, priority: r.priority }));
  }

  /** Set one coin's star priority. 0 clears it (all stars grey in the tab). */
  async upsertPriority(dto: UpsertSymbolPriorityDto): Promise<OkxSymbolPriorityDto> {
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

  /** Every coin the trader added by hand, oldest first. */
  async listWatchlist(): Promise<OkxWatchlistSymbolDto[]> {
    const rows = (await this.watchlistRepo.findAll()) as WatchlistRow[];
    return rows.map((r) => this.toWatchlistDto(r));
  }

  /**
   * Track a new coin in the Setup tab. The symbol is checked against OKX's
   * public contract list first — a typo would otherwise add a permanent row
   * that renders with no price and no chart. Re-adding an existing coin is a
   * no-op rather than an error.
   */
  async addWatchlistSymbol(dto: AddWatchlistSymbolDto): Promise<OkxWatchlistSymbolDto> {
    const symbol = dto.symbol.trim().toUpperCase();
    if (!symbol) throw new BadRequestException('Nhập mã coin.');
    try {
      await this.client.getInstrumentSpec(symbol);
    } catch {
      throw new BadRequestException(`OKX không có hợp đồng futures cho ${symbol}.`);
    }
    const row = (await this.watchlistRepo.add(symbol)) as WatchlistRow;
    return this.toWatchlistDto(row);
  }

  /** Stop tracking a coin. Only removes the manual row — traded coins stay. */
  async removeWatchlistSymbol(symbol: string): Promise<{ removed: true }> {
    const clean = symbol.trim().toUpperCase();
    const count = await this.watchlistRepo.remove(clean);
    if (count === 0) throw new NotFoundException(`${clean} không có trong danh sách theo dõi.`);
    return { removed: true };
  }

  private toWatchlistDto(row: WatchlistRow): OkxWatchlistSymbolDto {
    return { symbol: row.symbol, createdAt: row.createdAt.toISOString() };
  }

  private toDto(row: SetupConfigRow): OkxSetupConfigDto {
    return {
      symbol: row.symbol,
      holdSide: row.holdSide === 'short' ? 'short' : 'long',
      leverage: row.leverage,
      marginUsd: row.marginUsd,
    };
  }
}
