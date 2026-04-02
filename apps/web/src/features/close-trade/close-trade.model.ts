import { createApiClient } from '@web/shared/api/client';
import type {
  CloseDashboardOrderInput,
  DashboardOrder
} from '@web/shared/api/types';

type CloseOrderFormInput = {
  closePrice: string;
  note?: string;
  closedAt?: string;
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

export function parseCloseOrderFormData(formData: FormData): CloseOrderFormInput {
  const closePrice = requireText(formData.get('closePrice'), 'Close price');

  return {
    closePrice,
    note: formData.get('note')?.toString() ?? undefined,
    closedAt: formData.get('closedAt')?.toString() ?? undefined
  };
}

export async function submitCloseOrder(
  orderId: string,
  input: CloseOrderFormInput
): Promise<DashboardOrder> {
  const client = createApiClient();
  const payload: CloseDashboardOrderInput = {
    closePrice: toNumber(input.closePrice) ?? 0,
    note: input.note?.trim() || undefined,
    closedAt: input.closedAt?.trim() || undefined
  };

  return client.closeOrder(orderId, payload);
}
