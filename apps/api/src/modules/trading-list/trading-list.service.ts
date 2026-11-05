import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createTradingListRepository } from '@app/db';
import axios from 'axios';

import type { AddTradingListWatchlistDto } from './dto/add-trading-list-watchlist.dto';
import type { UpsertTradingListNoteDto } from './dto/upsert-trading-list-note.dto';
import type { UpsertTradingListPriorityDto } from './dto/upsert-trading-list-priority.dto';

export type TradingListPriorityDto = { symbol: string; priority: number };
export type TradingListNoteDto = { symbol: string; note: string; updatedAt: string | null };
export type TradingListExchange = 'bitget' | 'mexc';
/** `onlyExchange` null = the coin trades on both exchanges (or availability is not known yet). */
export type TradingListWatchlistDto = { symbol: string; onlyExchange: TradingListExchange | null; createdAt: string };

/** Guard against an accidental paste of a whole document into the note field. */
const MAX_NOTE_LENGTH = 20_000;

type PriorityRow = { symbol: string; priority: number };
type NoteRow = { symbol: string; note: string; updatedAt: Date };
type WatchlistRow = { symbol: string; onlyExchange: string | null; exchangesCheckedAt: Date | null; createdAt: Date };

/** Re-check a coin's exchange availability this often — a coin can get listed on the other exchange later. */
const AVAILABILITY_TTL_MS = 24 * 60 * 60 * 1000;
/** The two public contract lists are cached this long between reads. */
const CONTRACTS_CACHE_MS = 10 * 60 * 1000;
const CONTRACTS_TIMEOUT_MS = 8_000;

type ContractSets = { bitget: Set<string>; mexc: Set<string> };

function toDto(r: WatchlistRow): TradingListWatchlistDto {
  const only = r.onlyExchange === 'bitget' || r.onlyExchange === 'mexc' ? r.onlyExchange : null;
  return { symbol: r.symbol, onlyExchange: only, createdAt: r.createdAt.toISOString() };
}

/**
 * Per-coin data /trading-list shares between Bitget and MEXC: star priority,
 * assessment and the hand-added coins. Leverage/margin configs stay per
 * exchange (the /bitget and /mexc setup endpoints).
 */
@Injectable()
export class TradingListService {
  private readonly logger = new Logger(TradingListService.name);
  private readonly repo = createTradingListRepository();
  private contracts: { at: number; sets: ContractSets } | null = null;

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

  /**
   * Every coin of /trading-list (the table is the only source). Rows whose
   * exchange availability is unknown or older than a day are re-checked first;
   * when a contract list cannot be fetched they keep their last known value.
   */
  async listWatchlist(): Promise<TradingListWatchlistDto[]> {
    const rows = (await this.repo.findWatchlist()) as WatchlistRow[];
    const now = Date.now();
    const stale = rows.filter((r) => !r.exchangesCheckedAt || now - r.exchangesCheckedAt.getTime() > AVAILABILITY_TTL_MS);
    if (stale.length > 0) {
      const sets = await this.contractSets();
      if (sets) {
        const checkedAt = new Date();
        await Promise.all(
          stale.map(async (r) => {
            const only = this.onlyExchangeOf(r.symbol, sets);
            await this.repo.setWatchlistAvailability(r.symbol, only, checkedAt);
            r.onlyExchange = only;
            r.exchangesCheckedAt = checkedAt;
          }),
        );
      }
    }
    return rows.map(toDto);
  }

  /** A coin is accepted when at least one of the two exchanges lists a USDT-M contract for it. */
  async addWatchlistSymbol(dto: AddTradingListWatchlistDto): Promise<TradingListWatchlistDto> {
    const symbol = dto.symbol.trim().toUpperCase();
    if (!symbol) throw new BadRequestException('Nhập mã coin.');
    const sets = await this.contractSets(true);
    if (!sets) throw new BadRequestException('Không tải được danh sách hợp đồng của Bitget/MEXC — thử lại sau.');
    const onBitget = sets.bitget.has(symbol);
    const onMexc = sets.mexc.has(symbol);
    if (!onBitget && !onMexc) throw new BadRequestException(`Bitget và MEXC đều không có hợp đồng futures cho ${symbol}.`);
    const row = (await this.repo.addWatchlistSymbol(symbol, {
      onlyExchange: this.onlyExchangeOf(symbol, sets),
      exchangesCheckedAt: new Date(),
    })) as WatchlistRow;
    return toDto(row);
  }

  /** null when the coin is on both exchanges — or on neither (delisted), so nothing gets hidden by mistake. */
  private onlyExchangeOf(symbol: string, sets: ContractSets): TradingListExchange | null {
    const onBitget = sets.bitget.has(symbol);
    const onMexc = sets.mexc.has(symbol);
    if (onBitget && !onMexc) return 'bitget';
    if (onMexc && !onBitget) return 'mexc';
    return null;
  }

  /**
   * USDT-M contract symbols (as `BTCUSDT`) of both exchanges, from their public
   * full-list endpoints. Null when either list fails — a partial answer would
   * wrongly mark coins as single-exchange.
   */
  private async contractSets(fresh = false): Promise<ContractSets | null> {
    if (!fresh && this.contracts && Date.now() - this.contracts.at < CONTRACTS_CACHE_MS) return this.contracts.sets;
    try {
      const [bg, mx] = await Promise.all([
        axios.get<{ data?: Array<{ symbol: string; symbolStatus?: string }> }>(
          'https://api.bitget.com/api/v2/mix/market/contracts',
          { params: { productType: 'USDT-FUTURES' }, timeout: CONTRACTS_TIMEOUT_MS },
        ),
        axios.get<{ data?: Array<{ symbol: string; quoteCoin?: string; state?: number }> }>(
          'https://contract.mexc.com/api/v1/contract/detail',
          { timeout: CONTRACTS_TIMEOUT_MS },
        ),
      ]);
      const bgRows = bg.data?.data ?? [];
      const mxRows = mx.data?.data ?? [];
      if (bgRows.length === 0 || mxRows.length === 0) throw new Error('empty contract list');
      const sets: ContractSets = {
        // Bitget lists only tradable contracts here ("normal"); keep any other status out.
        bitget: new Set(bgRows.filter((c) => !c.symbolStatus || c.symbolStatus === 'normal').map((c) => c.symbol.toUpperCase())),
        // MEXC state 0 = enabled; other states are delisted / paused contracts.
        mexc: new Set(
          mxRows
            .filter((c) => (c.quoteCoin ?? 'USDT') === 'USDT' && (c.state ?? 0) === 0)
            .map((c) => c.symbol.toUpperCase().replace('_', '')),
        ),
      };
      this.contracts = { at: Date.now(), sets };
      return sets;
    } catch (err) {
      this.logger.warn(`Contract lists unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return this.contracts?.sets ?? null;
    }
  }

  async removeWatchlistSymbol(symbol: string): Promise<{ removed: true }> {
    const clean = symbol.trim().toUpperCase();
    const count = await this.repo.removeWatchlistSymbol(clean);
    if (count === 0) throw new NotFoundException(`${clean} không có trong danh sách coin.`);
    return { removed: true };
  }
}
