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
  'Nhiệm vụ: format lại đoạn markdown thô thành một bản ghi chép rõ ràng, có cấu trúc, dễ đọc lại sau này.',
  'QUY TẮC:',
  '- GIỮ NGUYÊN ý nghĩa, số liệu, và giọng văn tiếng Việt của người dùng. KHÔNG bịa thêm nội dung, KHÔNG đưa ra nhận định mới, KHÔNG tự suy ra số liệu hay kết luận mà người dùng không viết.',
  '- LUÔN thêm một dòng tiêu đề `# ...` ở đầu (ngắn gọn, tối đa khoảng 10 từ), tóm tắt đúng chủ đề/diễn biến chính trong nội dung (coin, xu hướng, hành động chính). Chỉ bỏ qua tiêu đề khi toàn bộ nội dung chỉ là một câu/một ý duy nhất, quá ngắn để tóm tắt.',
  // The old "≥3 lines" threshold was applied inconsistently by the model in practice — several
  // real entries with 4-9 lines came back with zero `##` headings. Replacing it with a single
  // clear exception (one short thought) removes the ambiguity that caused that drift.
  '- LUÔN nhóm nội dung thành các mục `##`, TRỪ khi toàn bộ nội dung chỉ là một ý/một câu duy nhất. Chỉ dùng mục nào thực sự có nội dung tương ứng — không thêm mục rỗng, không ép đủ cả 4 mục. Chọn trong nhóm tiêu đề sau (có thể đổi tên mục cho khớp nội dung nếu không mục nào ở đây phù hợp):',
  '  - `## Diễn biến thị trường` — chuyện gì đã xảy ra (giá, thanh khoản, tin tức)',
  '  - `## Phân tích` — nhận định, chỉ báo kỹ thuật, tâm lý thị trường/cá nhân',
  '  - `## Hành động` — quyết định/giao dịch đã thực hiện (mua, bán, entry, exit)',
  '  - `## Kế hoạch` — dự định, kịch bản cho các bước tiếp theo',
  '  Một dòng thuộc nhiều mục thì đặt vào mục sát nghĩa nhất; không lặp lại một ý ở hai mục.',
  // Without a fixed order, re-running the prompt on its own already-correct output reordered
  // sections (Hành động/Phân tích swapped) even though every line inside each section stayed
  // byte-identical — still a spurious diff in the revision history. Pinning the order removes
  // that remaining source of non-determinism.
  '  LUÔN xếp các mục đã chọn theo đúng thứ tự cố định này: Diễn biến thị trường → Phân tích → Hành động → Kế hoạch (bỏ qua mục nào không có nội dung, không đổi thứ tự dù input viết theo trình tự khác).',
  '- Dùng bullet list `-` cho các gạch đầu dòng trong mỗi mục.',
  '- In đậm `**...**` các thông tin quan trọng: mốc giá, %, chỉ báo (RSI, EMA, chỉ số tham lam/sợ hãi, thanh lý, funding...), và quyết định/hành động chính (mua, bán, entry, exit, chốt lời, cắt lỗ). Không lạm dụng in đậm cho câu chữ thông thường.',
  '- Sửa lỗi chính tả và lỗi gõ rõ ràng; thay các thực thể HTML như `&gt;` `&lt;` `&amp;` bằng ký tự thường (dùng chữ hoặc mũi tên → thay cho dấu > khi diễn đạt "dẫn tới").',
  '- Sửa thụt lề sai làm vỡ danh sách.',
  // Save now reformats the whole day's text on every update, and the day's revision history
  // diffs each save against the previous one. Re-wording an already-clean paragraph — or its
  // title/section headings — would show up as a change the user never made, so the format
  // (including the title and section choice) must be idempotent on clean input.
  '- QUAN TRỌNG: đoạn nào đã đúng format rồi (đã có tiêu đề, đã nhóm mục, đã in đậm đúng chỗ) thì GIỮ NGUYÊN VĂN từng chữ, từng dòng — KHÔNG viết lại, KHÔNG đảo câu, KHÔNG đổi từ đồng nghĩa, KHÔNG gộp/tách dòng, KHÔNG đổi tiêu đề `#`/`##` đã có. Chỉ thêm/sửa đúng phần thực sự thiếu hoặc sai format.',
  '- Nếu toàn bộ đầu vào đã sạch (đã có tiêu đề, đã nhóm mục, in đậm đúng chỗ), trả lại y nguyên đầu vào.',
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

  /** Reformat raw journal markdown via Claude Sonnet. Returns the cleaned markdown. */
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
