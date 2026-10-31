import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createTradingListRepository } from '@app/db';

import { BitgetTradeClient } from '../bitget/bitget-trade.client';
import { MexcTradeClient } from '../mexc/mexc-trade.client';
import type { AddTradingListWatchlistDto } from './dto/add-trading-list-watchlist.dto';
import type { UpsertTradingListNoteDto } from './dto/upsert-trading-list-note.dto';
import type { UpsertTradingListPriorityDto } from './dto/upsert-trading-list-priority.dto';

export type TradingListPriorityDto = { symbol: string; priority: number };
export type TradingListNoteDto = { symbol: string; note: string; updatedAt: string | null };
export type TradingListWatchlistDto = { symbol: string; createdAt: string };

/** Guard against an accidental paste of a whole document into the note field. */
const MAX_NOTE_LENGTH = 20_000;

type PriorityRow = { symbol: string; priority: number };
type NoteRow = { symbol: string; note: string; updatedAt: Date };
type WatchlistRow = { symbol: string; createdAt: Date };

/**
 * Per-coin data /trading-list shares between Bitget and MEXC: star priority,
 * assessment and the hand-added coins. Leverage/margin configs stay per
 * exchange (the /bitget and /mexc setup endpoints).
 */
@Injectable()
export class TradingListService {
  private readonly repo = createTradingListRepository();
  /** Public market-data lookups only — validate a coin before it is tracked. */
  private readonly bitget = new BitgetTradeClient();
  private readonly mexc = new MexcTradeClient();

  async listPriorities(): Promise<TradingListPriorityDto[]> {
    const rows = (await this.repo.findPriorities()) as PriorityRow[];
    return rows.map((r) => ({ symbol: r.symbol, priority: r.priority }));
  }

  async upsertPriority(dto: UpsertTradingListPriorityDto): Promise<TradingListPriorityDto> {
    const priority = Math.round(dto.priority);
    if (!(priority >= 0 && priority <= 5)) throw new BadRequestException('Mức ưu tiên phải trong khoảng 0–5 sao.');
    const row = (await this.repo.upsertPriority({ symbol: dto.symbol.trim().toUpperCase(), priority })) as PriorityRow;
    return { symbol: row.symbol, priority: row.priority };
  }

  async listNotes(): Promise<TradingListNoteDto[]> {
    const rows = (await this.repo.findNotes()) as NoteRow[];
    return rows.map((r) => ({ symbol: r.symbol, note: r.note, updatedAt: r.updatedAt.toISOString() }));
  }

  /** Clearing the text deletes the row, so "has a note" stays a row-exists check. */
  async upsertNote(dto: UpsertTradingListNoteDto): Promise<TradingListNoteDto> {
    const symbol = dto.symbol.trim().toUpperCase();
    const note = dto.note.trim();
    if (note.length > MAX_NOTE_LENGTH) throw new BadRequestException(`Đánh giá quá dài (tối đa ${MAX_NOTE_LENGTH} ký tự).`);
    if (!note) {
      await this.repo.removeNote(symbol);
      return { symbol, note: '', updatedAt: null };
    }
    const row = (await this.repo.upsertNote({ symbol, note })) as NoteRow;
    return { symbol: row.symbol, note: row.note, updatedAt: row.updatedAt.toISOString() };
  }

  async listWatchlist(): Promise<TradingListWatchlistDto[]> {
    const rows = (await this.repo.findWatchlist()) as WatchlistRow[];
    return rows.map((r) => ({ symbol: r.symbol, createdAt: r.createdAt.toISOString() }));
  }

  /** A coin is accepted when at least one of the two exchanges lists a USDT-M contract for it. */
  async addWatchlistSymbol(dto: AddTradingListWatchlistDto): Promise<TradingListWatchlistDto> {
    const symbol = dto.symbol.trim().toUpperCase();
    if (!symbol) throw new BadRequestException('Nhập mã coin.');
    const [onBitget, onMexc] = await Promise.all([
      this.bitget.getTickerPrice(symbol).then((p) => p > 0, () => false),
      this.mexc.getContractSpec(symbol).then(() => true, () => false),
    ]);
    if (!onBitget && !onMexc) throw new BadRequestException(`Bitget và MEXC đều không có hợp đồng futures cho ${symbol}.`);
    const row = (await this.repo.addWatchlistSymbol(symbol)) as WatchlistRow;
    return { symbol: row.symbol, createdAt: row.createdAt.toISOString() };
  }

  async removeWatchlistSymbol(symbol: string): Promise<{ removed: true }> {
    const clean = symbol.trim().toUpperCase();
    const count = await this.repo.removeWatchlistSymbol(clean);
    if (count === 0) throw new NotFoundException(`${clean} không có trong danh sách theo dõi.`);
    return { removed: true };
  }
}
