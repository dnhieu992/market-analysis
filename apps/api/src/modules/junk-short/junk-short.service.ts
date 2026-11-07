import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { createJunkShortCoinRepository } from '@app/db';

import type { AddJunkCoinsDto } from './dto/add-junk-coins.dto';

type PerpSymbol = { symbol: string; contractType: string; quoteAsset: string; status: string };

const PERP_CACHE_MS = 10 * 60_000;

/** `ordi`, `ORDI/USDT`, `ordi_usdt` → `ORDIUSDT`. */
export function normalizeJunkSymbol(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[\s_/-]/g, '');
  if (!s) return '';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

/**
 * The /short-junk coin list. A coin is only accepted when it has a trading Binance USDT-M
 * perpetual — the skill shorts on Binance futures, so anything else could never be traded.
 */
@Injectable()
export class JunkShortService {
  private readonly repo = createJunkShortCoinRepository();
  private perps: { at: number; set: Set<string> } | null = null;

  list() {
    return this.repo.findAll();
  }

  async add(dto: AddJunkCoinsDto) {
    const symbols = [...new Set(dto.symbols.map(normalizeJunkSymbol).filter((s) => /^[A-Z0-9]{5,30}$/.test(s)))];
    if (symbols.length === 0) throw new BadRequestException('Không có mã coin hợp lệ.');
    const perps = await this.binancePerps();
    const rejected = symbols.filter((s) => !perps.has(s));
    const accepted = symbols.filter((s) => perps.has(s));
    const added = [];
    for (const s of accepted) added.push(await this.repo.upsert(s, dto.note));
    return { added, rejected };
  }

  async update(symbol: string, note: string) {
    const s = normalizeJunkSymbol(symbol);
    try {
      return await this.repo.updateNote(s, note);
    } catch {
      throw new NotFoundException(`${s} không có trong danh sách coin rác.`);
    }
  }

  async remove(symbol: string) {
    const removed = await this.repo.remove(normalizeJunkSymbol(symbol));
    return { removed };
  }

  private async binancePerps(): Promise<Set<string>> {
    if (this.perps && Date.now() - this.perps.at < PERP_CACHE_MS) return this.perps.set;
    const base = process.env.BINANCE_FAPI_BASE_URL ?? 'https://fapi.binance.com';
    try {
      const { data } = await axios.get<{ symbols: PerpSymbol[] }>(`${base}/fapi/v1/exchangeInfo`, { timeout: 15_000 });
      const set = new Set(
        data.symbols
          .filter((p) => p.contractType === 'PERPETUAL' && p.quoteAsset === 'USDT' && p.status === 'TRADING')
          .map((p) => p.symbol),
      );
      this.perps = { at: Date.now(), set };
      return set;
    } catch (err) {
      throw new BadRequestException(`Không kiểm tra được danh sách futures Binance: ${(err as Error).message}`);
    }
  }
}
