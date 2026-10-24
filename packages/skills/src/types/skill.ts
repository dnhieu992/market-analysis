export type SkillCategory = 'analysis' | 'strategy' | 'education';

export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: SkillCategory;
  systemPrompt: string;
  tools: string[];
  exampleQuestions: string[];
  welcomeMessage: string;
  /** Used by another page (e.g. the /tracking-coins panel), not listed on /skills. */
  hidden?: boolean;
};
