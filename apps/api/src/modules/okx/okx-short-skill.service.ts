import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createChatSkillVersionRepository } from '@app/db';
import { OKX_SHORT_DEFAULT_ANALYSIS_SKILL } from '@app/skills';

export const OKX_SHORT_AI_SKILL_ID = 'okx-short-ai';

export type ShortSkillVersionDto = {
  version: number;
  content: string;
  note: string | null;
  author: 'USER' | 'LLM';
  createdAt: string;
};

export type ShortSkillDto = {
  /** 0 = nothing saved yet, the default shipped in code is in use. */
  version: number;
  content: string;
  isDefault: boolean;
  updatedAt: string | null;
  history: Array<Omit<ShortSkillVersionDto, 'content'> & { chars: number }>;
};

type Row = { version: number; content: string; note: string | null; author: string; createdAt: Date };
const toDto = (r: Row): ShortSkillVersionDto => ({
  version: r.version,
  content: r.content,
  note: r.note,
  author: r.author === 'LLM' ? 'LLM' : 'USER',
  createdAt: r.createdAt.toISOString(),
});

/**
 * The editable analysis skill of the /trades OKX short AI chat. Read on every reply, so an
 * edit (from the chat's update_short_skill tool or the Skill dialog) applies to the next
 * message — no deploy. Versions are append-only; a rollback writes a new version.
 */
@Injectable()
export class OkxShortSkillService {
  private readonly repo = createChatSkillVersionRepository();

  async current(): Promise<{ version: number; content: string; isDefault: boolean; updatedAt: string | null }> {
    const row = await this.repo.latest(OKX_SHORT_AI_SKILL_ID);
    if (!row) return { version: 0, content: OKX_SHORT_DEFAULT_ANALYSIS_SKILL, isDefault: true, updatedAt: null };
    return { version: row.version, content: row.content, isDefault: false, updatedAt: row.createdAt.toISOString() };
  }

  async get(): Promise<ShortSkillDto> {
    const [cur, rows] = await Promise.all([this.current(), this.repo.list(OKX_SHORT_AI_SKILL_ID)]);
    return {
      ...cur,
      history: rows.map((r) => {
        const { content, ...rest } = toDto(r);
        return { ...rest, chars: content.length };
      }),
    };
  }

  async getVersion(version: number): Promise<ShortSkillVersionDto> {
    const row = await this.repo.findVersion(OKX_SHORT_AI_SKILL_ID, version);
    if (!row) throw new NotFoundException(`Không có version ${version}.`);
    return toDto(row);
  }

  async update(content: string, note: string | null, author: 'USER' | 'LLM', conversationId?: string | null): Promise<ShortSkillVersionDto> {
    const text = content.trim();
    if (text.length < 20) throw new BadRequestException('Nội dung skill quá ngắn.');
    const cur = await this.current();
    if (!cur.isDefault && cur.content.trim() === text) throw new BadRequestException('Nội dung giống hệt bản hiện tại — không có gì thay đổi.');
    const row = await this.repo.append({ skillId: OKX_SHORT_AI_SKILL_ID, content: text, note, author, conversationId });
    return toDto(row);
  }

  async rollback(version: number): Promise<ShortSkillVersionDto> {
    const old = await this.getVersion(version);
    return this.update(old.content, `Khôi phục từ v${version}`, 'USER');
  }
}
