import { createTrackingCoinsRepository, createTrackingSetupRepository } from '@app/db';

import { buildTargets, fmtPx, plannedRR, validatePlan, type Direction, type OrderType } from './tracking-engine';

/** A setup as typed in the panel or proposed by Claude through propose_swing_setup. */
export type SetupInput = {
  symbol: string;
  direction: Direction;
  orderType: OrderType;
  entryPrice: number;
  stopLoss: number;
  targets: number[];
  targetPcts?: Array<number | null | undefined>;
  setupType?: string | null;
  timeframe?: string | null;
  confidence?: string | null;
  thesis?: string | null;
  triggerNote?: string | null;
  invalidation?: string | null;
};

/** Coins are stored bare ("ADA"); accept "ADAUSDT" too. */
export const bareSymbol = (s: string) => s.trim().toUpperCase().replace(/USDT$/, '');
export const pairOf = (bare: string) => `${bareSymbol(bare)}USDT`;

export class SetupInputError extends Error {}

/** Checks the plan, then stores it as PROPOSED (Claude) or WATCHING (typed in) with a CREATED event. */
export async function createTrackingSetup(
  input: SetupInput,
  opts: { source: 'CLAUDE' | 'MANUAL'; status: 'PROPOSED' | 'WATCHING'; conversationId?: string | null },
) {
  const repo = createTrackingSetupRepository();
  const symbol = bareSymbol(input.symbol);
  if (!(await createTrackingCoinsRepository().findCoinBySymbol(symbol))) {
    throw new SetupInputError(`${symbol} không có trong danh sách Tracking Coins.`);
  }
  const direction: Direction = input.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const orderType: OrderType = input.orderType === 'STOP' || input.orderType === 'MARKET' ? input.orderType : 'LIMIT';
  const targets = buildTargets(input.targets.map(Number), input.targetPcts);
  const problem = validatePlan(direction, Number(input.entryPrice), Number(input.stopLoss), targets);
  if (problem) throw new SetupInputError(problem);

  const config = await repo.getConfig();
  const text = (v?: string | null, max = 4000) => (v && v.trim() ? v.trim().slice(0, max) : null);
  const setup = await repo.create({
    symbol,
    source: opts.source,
    conversationId: opts.conversationId ?? null,
    direction,
    orderType,
    status: opts.status,
    setupType: text(input.setupType, 80),
    timeframe: text(input.timeframe, 6) ?? '4h',
    confidence: text(input.confidence, 20),
    thesis: text(input.thesis),
    triggerNote: text(input.triggerNote),
    invalidation: text(input.invalidation),
    entryPrice: Number(input.entryPrice),
    stopLoss: Number(input.stopLoss),
    targets,
    riskUsd: config.riskUsd,
  });
  const rr = plannedRR(setup.entryPrice, setup.stopLoss, targets).map((r, i) => `TP${i + 1} ${r}R`).join(' · ');
  await repo.addEvent({
    symbol,
    setupId: setup.id,
    type: 'CREATED',
    price: setup.entryPrice,
    message:
      `${opts.source === 'CLAUDE' ? 'Claude đề xuất' : 'Tự tạo'} setup ${direction} ${orderType} @ ${fmtPx(setup.entryPrice)}, ` +
      `SL ${fmtPx(setup.stopLoss)}, ${targets.map((t, i) => `TP${i + 1} ${fmtPx(t.price)} (${t.pct}%)`).join(', ')} — ${rr}.` +
      (opts.status === 'WATCHING' ? ' Trạng thái: theo dõi.' : ''),
  });
  return setup;
}
