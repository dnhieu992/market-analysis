import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  createAssetCategoryRepository,
  createAssetTransactionRepository,
  createHoldingRepository,
} from '@app/db';

import type { CreateAssetCategoryDto } from './dto/create-asset-category.dto';
import type { CreateAssetTransactionDto } from './dto/create-asset-transaction.dto';
import type { UpdateAssetCategoryDto } from './dto/update-asset-category.dto';

/** How many ledger rows the page shows. Balances are summed in SQL, not from this slice. */
const LEDGER_LIMIT = 200;

export type AssetCategoryDto = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  /** Net USDT sitting in this bucket right now (deposits + transfers in − withdrawals − out). */
  balanceUsdt: number;
};

export type AssetTransactionDto = {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER';
  amountUsdt: number;
  fromCategoryId: string | null;
  toCategoryId: string | null;
  note: string | null;
  occurredAt: string;
  createdAt: string;
};

/** One bucket whose balance counts as capital already committed, not spendable. */
export type AssetDeployedDto = {
  key: string;
  label: string;
  balanceUsdt: number;
};

/**
 * The "what can I still deploy?" breakdown, returned alongside the totals so the
 * page can show the arithmetic rather than an unexplained number.
 */
export type AssetAvailableDto = {
  availableUsdt: number;
  /** Cost basis of coins still held on spot — money spent, not sitting idle. */
  spentOnSpotUsdt: number;
  /** The `trading` / `bitget` / `mexc` buckets, each already committed. */
  deployed: AssetDeployedDto[];
};

export type AssetSummaryDto = {
  /** Sum of every bucket = total deposited − total withdrawn. Currency is always USDT. */
  totalUsdt: number;
  totalDepositedUsdt: number;
  totalWithdrawnUsdt: number;
  available: AssetAvailableDto;
  categories: AssetCategoryDto[];
  transactions: AssetTransactionDto[];
};

/**
 * Buckets treated as "already committed" when working out what is available.
 * Spot is deliberately absent: its allocation is only spent to the extent coins
 * were actually bought, which `spentOnSpotUsdt` measures directly.
 */
const DEPLOYED_KEYS = ['trading', 'bitget', 'mexc'] as const;

/** A slug the UI and future code can rely on: lowercase, digits, dash/underscore. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

@Injectable()
export class AssetService {
  private readonly categories = createAssetCategoryRepository();
  private readonly transactions = createAssetTransactionRepository();
  private readonly holdings = createHoldingRepository();

  /** Everything /my-asset renders in one round trip. */
  async getSummary(): Promise<AssetSummaryDto> {
    const [categories, balances, byType, transactions, spentOnSpotUsdt] = await Promise.all([
      this.categories.findAll(),
      this.transactions.sumBalances(),
      this.transactions.sumByType(),
      this.transactions.findAll(LEDGER_LIMIT),
      // Non-fatal: an unusable holdings table must not blank the whole page, it
      // just means nothing is known to be spent on spot yet.
      this.holdings.sumTotalCost().catch(() => 0),
    ]);

    const balanceById = new Map(balances.map((b) => [b.categoryId, b.balanceUsdt]));
    const categoryDtos = categories.map((c) => ({
      id: c.id,
      key: c.key,
      label: c.label,
      sortOrder: c.sortOrder,
      balanceUsdt: balanceById.get(c.id) ?? 0,
    }));

    const totalUsdt = categoryDtos.reduce((sum, c) => sum + c.balanceUsdt, 0);

    // available = total − spent buying spot − everything allocated to trading,
    // bitget and mexc. A deployed bucket the trader deleted simply drops out.
    const deployed: AssetDeployedDto[] = DEPLOYED_KEYS.flatMap((key) => {
      const category = categoryDtos.find((c) => c.key === key);
      return category
        ? [{ key: category.key, label: category.label, balanceUsdt: category.balanceUsdt }]
        : [];
    });
    const deployedTotal = deployed.reduce((sum, d) => sum + d.balanceUsdt, 0);

    return {
      totalUsdt,
      totalDepositedUsdt: byType.DEPOSIT ?? 0,
      totalWithdrawnUsdt: byType.WITHDRAW ?? 0,
      available: {
        availableUsdt: totalUsdt - spentOnSpotUsdt - deployedTotal,
        spentOnSpotUsdt,
        deployed,
      },
      categories: categoryDtos,
      transactions: transactions.map(toTransactionDto),
    };
  }

  async createCategory(input: CreateAssetCategoryDto): Promise<AssetCategoryDto> {
    const key = input.key.trim().toLowerCase();
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        'key chỉ được chứa chữ thường, số, dấu gạch ngang hoặc gạch dưới',
      );
    }
    if (await this.categories.findByKey(key)) {
      throw new ConflictException(`Danh mục "${key}" đã tồn tại`);
    }

    // New buckets land at the end of the page unless the caller places them.
    const existing = await this.categories.findAll();
    const sortOrder =
      input.sortOrder ?? existing.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;

    const created = await this.categories.create({ key, label: input.label.trim(), sortOrder });
    return { ...created, balanceUsdt: 0 };
  }

  async updateCategory(id: string, input: UpdateAssetCategoryDto): Promise<AssetCategoryDto> {
    await this.requireCategory(id);
    const updated = await this.categories.update(id, {
      ...(input.label === undefined ? {} : { label: input.label.trim() }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
    });
    const balances = await this.transactions.sumBalances();
    return {
      ...updated,
      balanceUsdt: balances.find((b) => b.categoryId === id)?.balanceUsdt ?? 0,
    };
  }

  /**
   * Deleting a bucket that still has history would silently change the total, so
   * the ledger has to be cleared first.
   */
  async deleteCategory(id: string): Promise<{ id: string }> {
    await this.requireCategory(id);
    const used = await this.categories.countTransactions(id);
    if (used > 0) {
      throw new ConflictException(
        `Danh mục còn ${used} giao dịch trong lịch sử — xoá các giao dịch đó trước`,
      );
    }
    await this.categories.deleteById(id);
    return { id };
  }

  async createTransaction(input: CreateAssetTransactionDto): Promise<AssetTransactionDto> {
    if (input.amountUsdt <= 0) {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }

    // Each type has exactly one valid shape of endpoints — reject the rest here so
    // the ledger can never hold a row the balance maths would misread.
    const from = input.fromCategoryId ?? null;
    const to = input.toCategoryId ?? null;

    if (input.type === 'DEPOSIT') {
      if (!to) throw new BadRequestException('Nạp cần chọn danh mục nhận (toCategoryId)');
      if (from) throw new BadRequestException('Nạp không có danh mục nguồn');
    } else if (input.type === 'WITHDRAW') {
      if (!from) throw new BadRequestException('Rút cần chọn danh mục nguồn (fromCategoryId)');
      if (to) throw new BadRequestException('Rút không có danh mục nhận');
    } else {
      if (!from || !to) throw new BadRequestException('Chuyển cần cả danh mục nguồn và nhận');
      if (from === to) throw new BadRequestException('Không thể chuyển vào chính danh mục đó');
    }

    if (from) await this.requireCategory(from);
    if (to) await this.requireCategory(to);

    const created = await this.transactions.create({
      type: input.type,
      amountUsdt: input.amountUsdt,
      fromCategoryId: from,
      toCategoryId: to,
      note: input.note?.trim() || null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    });

    return toTransactionDto(created);
  }

  async deleteTransaction(id: string): Promise<{ id: string }> {
    try {
      await this.transactions.deleteById(id);
    } catch {
      throw new NotFoundException(`Không tìm thấy giao dịch ${id}`);
    }
    return { id };
  }

  private async requireCategory(id: string) {
    const category = await this.categories.findById(id);
    if (!category) throw new NotFoundException(`Không tìm thấy danh mục ${id}`);
    return category;
  }
}

function toTransactionDto(row: {
  id: string;
  type: string;
  amountUsdt: unknown;
  fromCategoryId: string | null;
  toCategoryId: string | null;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
}): AssetTransactionDto {
  return {
    id: row.id,
    type: row.type as AssetTransactionDto['type'],
    amountUsdt: Number(row.amountUsdt),
    fromCategoryId: row.fromCategoryId,
    toCategoryId: row.toCategoryId,
    note: row.note,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
