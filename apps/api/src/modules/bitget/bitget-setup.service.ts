import { BadRequestException, Injectable } from '@nestjs/common';
import { createBitgetSetupConfigRepository } from '@app/db';

import type { BulkUpsertSetupConfigDto } from './dto/bulk-upsert-setup-config.dto';
import type { UpsertSetupConfigDto } from './dto/upsert-setup-config.dto';

export type BitgetSetupConfigDto = {
  symbol: string;
  holdSide: 'long' | 'short';
  leverage: number;
  marginUsd: number;
};

type SetupConfigRow = {
  symbol: string;
  holdSide: string;
  leverage: number;
  marginUsd: number;
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
   * Overwrite the config of every `symbols × holdSides` pair with the same
   * leverage/margin, in one transaction. Duplicate symbols are collapsed so a
   * sloppy client payload can't fight itself inside the transaction.
   */
  async upsertMany(dto: BulkUpsertSetupConfigDto): Promise<BitgetSetupConfigDto[]> {
    if (!(dto.leverage >= 1 && dto.leverage <= 125)) {
      throw new BadRequestException('Đòn bẩy phải trong khoảng 1–125.');
    }
    if (!(dto.marginUsd >= 0)) {
      throw new BadRequestException('Ký quỹ không hợp lệ.');
    }
    const symbols = [...new Set(dto.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    const holdSides = [...new Set(dto.holdSides.map((s) => (s === 'short' ? 'short' : 'long')))];
    if (symbols.length === 0) throw new BadRequestException('Chọn ít nhất 1 coin.');
    if (holdSides.length === 0) throw new BadRequestException('Chọn ít nhất 1 hướng (Long/Short).');

    const inputs = symbols.flatMap((symbol) =>
      holdSides.map((holdSide) => ({
        symbol,
        holdSide,
        leverage: Math.round(dto.leverage),
        marginUsd: dto.marginUsd,
      })),
    );
    const rows = (await this.repo.upsertMany(inputs)) as SetupConfigRow[];
    return rows.map((r) => this.toDto(r));
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
