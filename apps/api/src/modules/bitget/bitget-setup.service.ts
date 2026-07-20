import { BadRequestException, Injectable } from '@nestjs/common';
import { createBitgetSetupConfigRepository } from '@app/db';

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

  private toDto(row: SetupConfigRow): BitgetSetupConfigDto {
    return {
      symbol: row.symbol,
      holdSide: row.holdSide === 'short' ? 'short' : 'long',
      leverage: row.leverage,
      marginUsd: row.marginUsd,
    };
  }
}
