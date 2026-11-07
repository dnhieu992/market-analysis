import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { scanJunkShorts } from '@app/core';
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

  /**
   * "Sync từ Binance": scan every Binance USDT-M perp through the study's junk gates (spot + perp,
   * futures ≥ 90 days, cap $20–500M, ≥ 50% below ATH on the last closed D1) and add the coins that
   * pass and are not on the list yet. Never removes or overwrites a coin — `noLongerJunk` lists the
   * synced coins that stopped passing, for the user to decide.
   */
  async syncFromBinance() {
    let scan;
    try {
      scan = await scanJunkShorts({ topGainers: 0, fapiBaseUrl: process.env.BINANCE_FAPI_BASE_URL });
    } catch (err) {
      throw new BadRequestException(`Không quét được Binance: ${(err as Error).message}`);
    }
    const day = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const junk = scan.universe.junkTodayCoins;
    const before = await this.repo.findAll();
    const listed = new Set(before.map((c) => c.symbol));
    const fresh = junk.filter((j) => !listed.has(j.symbol));
    await this.repo.addMissing(
      fresh.map((j) => ({
        symbol: j.symbol,
        source: 'BINANCE_SYNC',
        note: `Sync Binance ${day} · cap $${j.capUsdM}M · −${j.belowAthPct}% ATH · list ${j.listingDays} ngày`,
      })),
    );
    const junkSet = new Set(junk.map((j) => j.symbol));
    return {
      scanned: scan.universe.scanned,
      junk: junk.length,
      added: fresh.map((j) => j.symbol),
      noLongerJunk: before.filter((c) => c.source === 'BINANCE_SYNC' && !junkSet.has(c.symbol)).map((c) => c.symbol),
      coins: await this.repo.findAll(),
    };
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
