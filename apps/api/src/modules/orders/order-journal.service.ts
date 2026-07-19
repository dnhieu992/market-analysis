import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  createOrderJournalRepository,
  type OrderJournalSnapshot,
} from '@app/db';

import type { CreateOrderJournalDto } from './dto/create-order-journal.dto';
import type { UpdateOrderJournalDto } from './dto/update-order-journal.dto';

export type OrderJournalNoteDto = {
  id: string;
  orderId: string;
  /** "manual" (trader note) or "system" (auto open/close event — read-only). */
  kind: 'manual' | 'system';
  content: string;
  images: string[];
  snapshot: OrderJournalSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

type JournalRow = {
  id: string;
  orderId: string;
  kind: string;
  content: string;
  images: unknown;
  snapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Manual per-order note timeline for a /trades Order. Notes are grouped by
 * `orderId`. Markdown reformatting is done client-side via the shared
 * /journal/reformat endpoint before the note is posted here — this service
 * just persists. System items (auto open/close logs) are read-only.
 */
@Injectable()
export class OrderJournalService {
  private readonly repo = createOrderJournalRepository();

  private map(r: JournalRow): OrderJournalNoteDto {
    return {
      id: r.id,
      orderId: r.orderId,
      kind: r.kind === 'system' ? 'system' : 'manual',
      content: r.content,
      images: toStringArray(r.images),
      snapshot: (r.snapshot as OrderJournalSnapshot | null) ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /** All notes for one order, oldest first. */
  async list(orderId: string): Promise<OrderJournalNoteDto[]> {
    if (!orderId) return [];
    const rows = await this.repo.findByOrderId(orderId);
    return rows.map((r) => this.map(r));
  }

  async create(input: CreateOrderJournalDto): Promise<OrderJournalNoteDto> {
    const row = await this.repo.create({
      orderId: input.orderId,
      content: input.content,
      images: input.images ?? [],
      snapshot: input.snapshot ?? null,
    });
    return this.map(row);
  }

  async update(id: string, input: UpdateOrderJournalDto): Promise<OrderJournalNoteDto> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Order journal note ${id} not found`);
    if (existing.kind === 'system') {
      throw new BadRequestException('Log hệ thống (mở/đóng lệnh) không thể sửa.');
    }
    const row = await this.repo.update(id, { content: input.content, images: input.images ?? [] });
    return this.map(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Order journal note ${id} not found`);
    if (existing.kind === 'system') {
      throw new BadRequestException('Log hệ thống (mở/đóng lệnh) không thể xoá.');
    }
    await this.repo.deleteById(id);
  }
}
