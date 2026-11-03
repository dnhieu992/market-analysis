import type { SkillDefinition } from './types/skill';
import { priceActionSkill } from './price-action';
import { breakoutSkill } from './breakout';
import { swingSkill } from './swing';
import { dcaSkill } from './dca';
import { riskManagementSkill } from './risk-management';
import { shortBtcDailySkill } from './short-btc-daily';
import { shortJunkSkill } from './short-junk';
import { scalpingSkill } from './scalping';
import { trackingSwingSkill } from './tracking-swing';
import { bitgetAiSkill } from './bitget-ai';
import { mexcAiSkill } from './mexc-ai';
import { tradingListAiSkill } from './trading-list-ai';
import { tradingAnalysisSkill } from './trading-analysis';

export const SKILLS: SkillDefinition[] = [
  priceActionSkill,
  breakoutSkill,
  swingSkill,
  dcaSkill,
  riskManagementSkill,
  shortBtcDailySkill,
  shortJunkSkill,
  scalpingSkill,
  trackingSwingSkill,
  bitgetAiSkill,
  mexcAiSkill,
  tradingListAiSkill,
  tradingAnalysisSkill,
];

export function getSkillById(id: string): SkillDefinition | undefined {
  return SKILLS.find((s) => s.id === id);
}
