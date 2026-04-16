import { createApiClient } from '@web/shared/api/client';
import type {
  CreateDashboardOrderInput,
  DashboardOrder
} from '@web/shared/api/types';

type ManualOrderFormInput = {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: string;
  stopLoss?: string;
  takeProfit?: string;
  volume?: string;
  exchange?: string;
  broker?: string;
  orderType?: string;
  openedAt?: string;
  note?: string;
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
    volume: formData.get('volume')?.toString() ?? undefined,
    exchange: formData.get('exchange')?.toString() || undefined,
    broker: formData.get('broker')?.toString() || undefined,
    orderType: formData.get('orderType')?.toString() || undefined,
    openedAt: formData.get('openedAt')?.toString() ?? undefined,
    note: formData.get('note')?.toString() ?? undefined
  };
}

export async function submitManualOrder(input: ManualOrderFormInput): Promise<DashboardOrder> {
  const client = createApiClient();

  const entryPrice = toNumber(input.entryPrice) ?? 0;
  const volume = toNumber(input.volume);
  const quantity = volume != null && entryPrice > 0 ? volume / entryPrice : undefined;

  const payload: CreateDashboardOrderInput = {
    symbol: input.symbol,
    side: input.side,
    entryPrice,
    stopLoss: toNumber(input.stopLoss),
    takeProfit: toNumber(input.takeProfit),
    quantity,
    exchange: input.exchange?.trim() || undefined,
    broker: input.broker?.trim() || undefined,
    orderType: (input.orderType?.trim() as 'market' | 'limit' | undefined) || undefined,
    openedAt: input.openedAt?.trim() || undefined,
    note: input.note?.trim() || undefined
  };

  return client.createOrder(payload);
}
