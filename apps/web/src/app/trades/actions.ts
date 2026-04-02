import { createApiClient } from '../../lib/api';
import type { CreateDashboardOrderInput, DashboardOrder } from '../../lib/types';

type ManualOrderFormInput = {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: string;
  stopLoss?: string;
  takeProfit?: string;
  quantity?: string;
  leverage?: string;
  exchange?: string;
  openedAt?: string;
  note?: string;
  signalId?: string;
};

function requireText(value: FormDataEntryValue | null, fieldName: string): string {
  const normalized = value?.toString().trim() ?? '';

  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}

function toNumber(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }

  return parsed;
}

export function parseCreateOrderFormData(formData: FormData): ManualOrderFormInput {
  const symbol = requireText(formData.get('symbol'), 'Symbol');
  const side = requireText(formData.get('side'), 'Side');

  if (side !== 'long' && side !== 'short') {
    throw new Error('Side must be long or short');
  }

  const entryPrice = requireText(formData.get('entryPrice'), 'Entry price');

  return {
    symbol,
    side,
    entryPrice,
    stopLoss: formData.get('stopLoss')?.toString() ?? undefined,
    takeProfit: formData.get('takeProfit')?.toString() ?? undefined,
    quantity: formData.get('quantity')?.toString() ?? undefined,
    leverage: formData.get('leverage')?.toString() ?? undefined,
    exchange: formData.get('exchange')?.toString() ?? undefined,
    openedAt: formData.get('openedAt')?.toString() ?? undefined,
    note: formData.get('note')?.toString() ?? undefined,
    signalId: formData.get('signalId')?.toString() ?? undefined
  };
}

export async function submitManualOrder(input: ManualOrderFormInput): Promise<DashboardOrder> {
  const client = createApiClient();
  const payload: CreateDashboardOrderInput = {
    symbol: input.symbol,
    side: input.side,
    entryPrice: toNumber(input.entryPrice) ?? 0,
    stopLoss: toNumber(input.stopLoss),
    takeProfit: toNumber(input.takeProfit),
    quantity: toNumber(input.quantity),
    leverage: toNumber(input.leverage),
    exchange: input.exchange?.trim() || undefined,
    openedAt: input.openedAt?.trim() || undefined,
    note: input.note?.trim() || undefined,
    signalId: input.signalId?.trim() || undefined
  };

  return client.createOrder(payload);
}
