import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createTradingJournalRepository } from '@app/db';

/**
 * Sonnet, not Haiku. Save now reformats the whole day on every update and the revision history
 * diffs each save against the last, so the format must be a fixed point: already-clean text has
 * to come back verbatim. Measured on a real entry — Haiku 4.5 rewrote 1-3 of 5 lines on a second
 * pass (it applied the `##` grouping rule only on a later run, restructuring the morning's text);
 * Sonnet 4.6 converged on the first pass and returned it byte-identical on the second. A journal
 * is saved a handful of times a day, so the cost difference is noise next to clean diffs.
 */
const REFORMAT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

const REFORMAT_SYSTEM = [
  'Bạn là trợ lý biên tập nhật ký giao dịch (trading journal) của người dùng.',
  'Nhiệm vụ: format lại đoạn markdown thô thành markdown sạch, dễ đọc.',
  'QUY TẮC:',
  '- GIỮ NGUYÊN ý nghĩa, số liệu, và giọng văn tiếng Việt của người dùng. KHÔNG bịa thêm nội dung, KHÔNG đưa ra nhận định mới.',
  // "khi phù hợp" made this non-deterministic: the first pass often skipped headings and a later
  // pass added them, restructuring text the trader wrote hours earlier. A hard threshold makes
  // the very first format land on the shape every later pass agrees with.
  '- Nếu nội dung có từ 3 dòng trở lên: LUÔN nhóm thành các mục có tiêu đề `##` (ví dụ: Bối cảnh thị trường, Phân tích, Giao dịch, Kết luận & Kế hoạch). Dưới 3 dòng thì không thêm tiêu đề.',
  '- Dùng bullet list `-` cho các gạch đầu dòng; in đậm `**...**` cho các mốc giá, chỉ báo, quyết định quan trọng.',
  '- Sửa lỗi chính tả và lỗi gõ rõ ràng; thay các thực thể HTML như `&gt;` `&lt;` `&amp;` bằng ký tự thường (dùng chữ hoặc mũi tên → thay cho dấu > khi diễn đạt "dẫn tới").',
  '- Sửa thụt lề sai làm vỡ danh sách.',
  // Save now reformats the whole day's text on every update, and the day's revision history
  // diffs each save against the previous one. Re-wording an already-clean paragraph would show
  // up as a change the user never made, so formatting must be idempotent on clean input.
  '- QUAN TRỌNG: đoạn nào đã đúng format rồi thì GIỮ NGUYÊN VĂN từng chữ, từng dòng — KHÔNG viết lại, KHÔNG đảo câu, KHÔNG đổi từ đồng nghĩa, KHÔNG gộp/tách dòng. Chỉ động vào đúng chỗ thực sự sai format hoặc sai chính tả.',
  '- Nếu toàn bộ đầu vào đã sạch, trả lại y nguyên đầu vào.',
  '- KHÔNG bọc kết quả trong ```code fence```. Chỉ trả về đúng nội dung markdown đã format, không thêm lời giải thích, không mở đầu, không kết luận thừa.',
].join('\n');

export type JournalEntryDto = {
  id: string;
  date: string; // ISO date YYYY-MM-DD
  content: string;
  images: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** One save of a day, as it looked at that moment. */
export type JournalRevisionDto = {
  id: string;
  content: string;
  images: string[];
  tags: string[];
  createdAt: string;
};

/** Coerce a Prisma Json column (unknown at the type level) to a string[]. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** Parse an ISO date (YYYY-MM-DD) to a UTC-midnight Date for the @db.Date column. */
function toDateOnly(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

type JournalRow = {
  id: string;
  date: Date;
  content: string;
  images: unknown;
  tags: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type JournalRevisionRow = {
  id: string;
  content: string;
  images: unknown;
  tags: unknown;
  createdAt: Date;
};

@Injectable()
export class JournalService {
  private readonly repo = createTradingJournalRepository();

  private map(r: JournalRow): JournalEntryDto {
    return {
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      content: r.content,
      images: toStringArray(r.images),
      tags: toStringArray(r.tags),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private mapRevision(r: JournalRevisionRow): JournalRevisionDto {
    return {
      id: r.id,
      content: r.content,
      images: toStringArray(r.images),
      tags: toStringArray(r.tags),
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(): Promise<JournalEntryDto[]> {
    const rows = await this.repo.findAll();
    return rows.map((r) => this.map(r));
  }

  async getByDate(date: string): Promise<JournalEntryDto | null> {
    const row = await this.repo.findByDate(toDateOnly(date));
    return row ? this.map(row) : null;
  }

  /** Intra-day save history for one day, newest first. */
  async listRevisions(entryId: string): Promise<JournalRevisionDto[]> {
    const entry = await this.repo.findById(entryId);
    if (!entry) throw new NotFoundException(`Journal entry ${entryId} not found`);
    const rows = await this.repo.findRevisionsByEntryId(entryId);
    return rows.map((r: JournalRevisionRow) => this.mapRevision(r));
  }

  /** Create or update the entry for a calendar day; the repository snapshots it as a revision. */
  async upsert(input: { date: string; content: string; images?: string[]; tags?: string[] }): Promise<JournalEntryDto> {
    const row = await this.repo.upsertByDate({
      date: toDateOnly(input.date),
      content: input.content,
      images: input.images ?? [],
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
    });
    return this.map(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Journal entry ${id} not found`);
    await this.repo.deleteById(id);
  }

  /** Reformat raw journal markdown via Claude Haiku. Returns the cleaned markdown. */
  async reformat(content: string): Promise<{ content: string }> {
    const trimmed = (content ?? '').trim();
    if (!trimmed) return { content: '' };

    const apiKey = (process.env.CLAUDE_API_KEY ?? '').trim();
    if (!apiKey) throw new ServiceUnavailableException('CLAUDE_API_KEY chưa được cấu hình');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: REFORMAT_MODEL,
          max_tokens: 4096,
          system: REFORMAT_SYSTEM,
          messages: [{ role: 'user', content: trimmed }],
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Claude API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const formatted = (data.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
        .trim();

      return { content: formatted || trimmed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(`Không thể format lại nhật ký: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
