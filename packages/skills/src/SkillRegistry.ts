import type { SkillDefinition } from './types/skill';
import { priceActionSkill } from './price-action';
import { breakoutSkill } from './breakout';
import { swingSkill } from './swing';
import { dcaSkill } from './dca';
import { riskManagementSkill } from './risk-management';
import { shortBtcDailySkill } from './short-btc-daily';

export const SKILLS: SkillDefinition[] = [
  priceActionSkill,
  breakoutSkill,
  swingSkill,
  dcaSkill,
  riskManagementSkill,
  shortBtcDailySkill,
];

export function getSkillById(id: string): SkillDefinition | undefined {
  return SKILLS.find((s) => s.id === id);
}
