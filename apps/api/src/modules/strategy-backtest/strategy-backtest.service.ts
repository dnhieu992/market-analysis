import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  computeDistanceToEntryPct,
  computeSetupPlannedRr,
  computeSetupPnlPct,
  computeSetupRMultiple,
  type SetupDirection,
} from '@app/core';
import { createStrategyBacktestRepository } from '@app/db';

import { MarketDataService } from '../market/market-data.service';
import type { CloseSetupDto } from './dto/close-setup.dto';
import type { CreateSetupDto } from './dto/create-setup.dto';
import type { InvalidateSetupDto } from './dto/invalidate-setup.dto';
import type { UpdateSetupDto } from './dto/update-setup.dto';

const DEFAULT_SYMBOL = 'BTCUSDT';

/** Prices may only be edited while the setup is still waiting to fill. */
const EDITABLE_STATUS = 'PENDING';

export type StrategyBacktestSetupDto = {
  id: string;
  symbol: string;
  direction: SetupDirection;
  setupType: 'SWING' | 'SCALP';
  orderType: 'LIMIT' | 'MARKET';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number | null;
  note: string | null;
  images: string[];
  status: string;
  invalidReason: string | null;
  triggeredAt: string | null;
  closedAt: string | null;
  exitPrice: number | null;
  pnlPct: number | null;
  rMultiple: number | null;
  lastPrice: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Planned reward:risk, recomputed here rather than stored — it never changes. */
  plannedRr: number | null;
  /** Live-price fields, present only while the setup is open (null once closed). */
  distanceToEntryPct: number | null;
  unrealizedPct: number | null;
  unrealizedR: number | null;
};

export type StrategyBacktestBoard = {
  /** Live price of the tracked symbol, or null when Binance is unreachable. */
  price: number | null;
  symbol: string;
  setups: StrategyBacktestSetupDto[];
};

type SetupRow = Awaited<
  ReturnType<ReturnType<typeof createStrategyBacktestRepository>['list']>
>[number];

@Injectable()
export class StrategyBacktestService {
  private readonly logger = new Logger(StrategyBacktestService.name);
  private readonly repository = createStrategyBacktestRepository();

  constructor(private readonly marketDataService: MarketDataService) {}

  /**
   * The whole board in one round trip: the setups plus the live price they are
   * measured against, so the page never has to fan out a second request just to
   * show how far BTC still is from an entry.
   */
  async list(): Promise<StrategyBacktestBoard> {
    const rows = await this.repository.list();
    const price = await this.fetchPrice(rows[0]?.symbol ?? DEFAULT_SYMBOL);

    return {
      price,
      symbol: DEFAULT_SYMBOL,
      setups: rows.map((row) => this.toDto(row, price)),
    };
  }

  /**
   * A LIMIT setup is stored as PENDING at the price the trader typed. A MARKET setup is
   * entered on the spot: the server captures the live price as the entry and writes the
   * row straight to ENTERED, so it never passes through PENDING and the entry can never
   * be a level that did not actually trade.
   */
  async create(dto: CreateSetupDto): Promise<StrategyBacktestSetupDto> {
    const symbol = (dto.symbol ?? DEFAULT_SYMBOL).toUpperCase();
    const orderType = dto.orderType ?? 'LIMIT';
    const takeProfit = dto.takeProfit ?? null;
    const livePrice = await this.fetchPrice(symbol);

    let entryPrice: number;
    if (orderType === 'MARKET') {
      if (livePrice == null) {
        throw new BadRequestException(
          'Không lấy được giá thị trường nên chưa vào lệnh market được. Thử lại, hoặc đặt lệnh limit.',
        );
      }
      entryPrice = livePrice;
    } else {
      if (dto.entryPrice == null) {
        throw new BadRequestException('Lệnh limit cần giá entry.');
      }
      entryPrice = dto.entryPrice;
    }

    assertCoherent(dto.direction, entryPrice, dto.stopLoss, takeProfit, orderType);

    const enteredAt = new Date();
    const row = await this.repository.create({
      symbol,
      direction: dto.direction,
      setupType: dto.setupType ?? 'SWING',
      orderType,
      entryPrice,
      stopLoss: dto.stopLoss,
      takeProfit,
      note: dto.note?.trim() ? dto.note : null,
      images: dto.images ?? [],
      ...(orderType === 'MARKET'
        ? { status: 'ENTERED', triggeredAt: enteredAt, lastPrice: entryPrice }
        : {}),
    });

    return this.toDto(row, livePrice);
  }

  async update(id: string, dto: UpdateSetupDto): Promise<StrategyBacktestSetupDto> {
    const row = await this.requireSetup(id);
    const touchesPrices =
      dto.entryPrice !== undefined || dto.stopLoss !== undefined || dto.takeProfit !== undefined;

    if (touchesPrices && row.status !== EDITABLE_STATUS) {
      throw new BadRequestException(
        'Chỉ sửa được giá khi lệnh còn đang chờ khớp. Lệnh đã khớp/đã đóng chỉ sửa được ghi chú.',
      );
    }

    const entryPrice = dto.entryPrice ?? row.entryPrice;
    const stopLoss = dto.stopLoss ?? row.stopLoss;
    const takeProfit = dto.takeProfit !== undefined ? dto.takeProfit : row.takeProfit;
    const direction = toDirection(row.direction);
    if (touchesPrices) assertCoherent(direction, entryPrice, stopLoss, takeProfit);


    const updated = await this.repository.update(id, {
      entryPrice,
      stopLoss,
      takeProfit,
      ...(dto.note !== undefined ? { note: dto.note.trim() ? dto.note : null } : {}),
    });

    return this.toDto(updated, await this.fetchPrice(updated.symbol));
  }

  /**
   * Call a setup off — the trader saying "the reasoning behind this one no longer holds".
   * It applies to a setup that has already filled, not just a waiting one, and it is the
   * only way off the board: nothing here is ever deleted, so an abandoned plan stays
   * visible with its reason. The setup leaves the scan job's open list immediately and is
   * left out of the scorecard, so it never counts as either a win or a loss.
   */
  async invalidate(id: string, dto: InvalidateSetupDto): Promise<StrategyBacktestSetupDto> {
    const row = await this.requireSetup(id);
    if (row.status !== 'PENDING' && row.status !== 'ENTERED') {
      throw new BadRequestException('Chỉ đánh dấu invalid được lệnh đang chờ khớp hoặc đang chạy.');
    }

    const reason = dto.reason?.trim();
    const updated = await this.repository.update(id, {
      status: 'INVALID',
      invalidReason: reason ? reason : null,
      closedAt: new Date(),
    });

    return this.toDto(updated, await this.fetchPrice(updated.symbol));
  }

  /**
   * Close a filled setup by hand — the "I took profit early / cut it early" exit.
   * Scored with the same formula as a TP/SL hit so the stats stay comparable.
   */
  async close(id: string, dto: CloseSetupDto): Promise<StrategyBacktestSetupDto> {
    const row = await this.requireSetup(id);
    if (row.status !== 'ENTERED') {
      throw new BadRequestException('Chỉ đóng tay được lệnh đã khớp.');
    }

    const livePrice = await this.fetchPrice(row.symbol);
    const exitPrice = dto.exitPrice ?? livePrice;
    if (exitPrice == null) {
      throw new BadRequestException(
        'Không lấy được giá thị trường. Nhập giá đóng thủ công để chốt lệnh.',
      );
    }

    const direction = toDirection(row.direction);
    const updated = await this.repository.update(id, {
      status: 'CLOSED',
      closedAt: new Date(),
      exitPrice,
      pnlPct: computeSetupPnlPct(direction, row.entryPrice, exitPrice),
      rMultiple: computeSetupRMultiple(direction, row.entryPrice, row.stopLoss, exitPrice),
      lastPrice: livePrice ?? exitPrice,
    });

    return this.toDto(updated, livePrice);
  }

  private async requireSetup(id: string): Promise<SetupRow> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException(`Không tìm thấy setup ${id}`);
    return row;
  }

  /** Non-fatal: the board still renders (without live numbers) if Binance is down. */
  private async fetchPrice(symbol: string): Promise<number | null> {
    try {
      const candles = await this.marketDataService.getCandles(symbol, '5m', 1);
      return candles[candles.length - 1]?.close ?? null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Live price unavailable for ${symbol} (non-fatal): ${msg}`);
      return null;
    }
  }

  private toDto(row: SetupRow, price: number | null): StrategyBacktestSetupDto {
    const direction = toDirection(row.direction);
    const isOpen = row.status === 'PENDING' || row.status === 'ENTERED';
    const live = isOpen ? (price ?? row.lastPrice) : null;

    return {
      id: row.id,
      symbol: row.symbol,
      direction,
      setupType: row.setupType === 'SCALP' ? 'SCALP' : 'SWING',
      orderType: row.orderType === 'MARKET' ? 'MARKET' : 'LIMIT',
      entryPrice: row.entryPrice,
      stopLoss: row.stopLoss,
      takeProfit: row.takeProfit,
      note: row.note,
      images: toStringArray(row.images),
      status: row.status,
      invalidReason: row.invalidReason,
      triggeredAt: row.triggeredAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      exitPrice: row.exitPrice,
      pnlPct: row.pnlPct,
      rMultiple: row.rMultiple,
      lastPrice: row.lastPrice,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      plannedRr: computeSetupPlannedRr(direction, row.entryPrice, row.stopLoss, row.takeProfit),
      distanceToEntryPct:
        live != null && row.status === 'PENDING'
          ? computeDistanceToEntryPct(direction, row.entryPrice, live)
          : null,
      unrealizedPct:
        live != null && row.status === 'ENTERED'
          ? computeSetupPnlPct(direction, row.entryPrice, live)
          : null,
      unrealizedR:
        live != null && row.status === 'ENTERED'
          ? computeSetupRMultiple(direction, row.entryPrice, row.stopLoss, live)
          : null,
    };
  }
}

/** Coerce a Prisma Json column (unknown at the type level) to a string[]. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function toDirection(value: string): SetupDirection {
  return value === 'SHORT' ? 'SHORT' : 'LONG';
}

/**
 * The three prices have to describe a real trade before it is worth tracking: a LONG
 * stop below the entry and a target above it, mirrored for a SHORT. Catching this at
 * write time means the scan job never has to defend against a setup that would fill
 * and stop out on the same tick.
 *
 * For a MARKET setup the entry is the live price the server just read, so a rejection
 * here means the stop or target sits on the wrong side of the *current* price — the
 * message says so, otherwise it reads as if the trader mistyped a number they never
 * entered.
 */
function assertCoherent(
  direction: SetupDirection,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number | null,
  orderType: 'LIMIT' | 'MARKET' = 'LIMIT',
): void {
  const isLong = direction === 'LONG';
  const entryLabel =
    orderType === 'MARKET' ? `giá thị trường hiện tại (${entryPrice})` : 'giá entry';

  if (isLong && stopLoss >= entryPrice) {
    throw new BadRequestException(`Lệnh LONG: stop loss phải thấp hơn ${entryLabel}.`);
  }
  if (!isLong && stopLoss <= entryPrice) {
    throw new BadRequestException(`Lệnh SHORT: stop loss phải cao hơn ${entryLabel}.`);
  }
  if (takeProfit != null) {
    if (isLong && takeProfit <= entryPrice) {
      throw new BadRequestException(`Lệnh LONG: take profit phải cao hơn ${entryLabel}.`);
    }
    if (!isLong && takeProfit >= entryPrice) {
      throw new BadRequestException(`Lệnh SHORT: take profit phải thấp hơn ${entryLabel}.`);
    }
  }
}
