import { Injectable, NotFoundException } from '@nestjs/common';
import { SKILLS, getSkillById } from '@app/skills';

export type SkillPublicDto = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tools: string[];
  exampleQuestions: string[];
  welcomeMessage: string;
};

@Injectable()
export class SkillsService {
  getAll(): SkillPublicDto[] {
    // Hidden skills belong to another page (the /tracking-coins panel), not the /skills list.
    return SKILLS.filter((s) => !s.hidden).map(({ id, name, description, icon, category, tools, exampleQuestions, welcomeMessage }) => ({
      id, name, description, icon, category, tools, exampleQuestions, welcomeMessage
    }));
  }

  getById(id: string): SkillPublicDto {
    const skill = getSkillById(id);
    if (!skill) throw new NotFoundException(`Skill "${id}" not found`);
    const { id: skillId, name, description, icon, category, tools, exampleQuestions, welcomeMessage } = skill;
    return { id: skillId, name, description, icon, category, tools, exampleQuestions, welcomeMessage };
  }
}
