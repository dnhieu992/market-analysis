import { createApiClient } from '@web/shared/api/client';
import type { DashboardOrder, UpdateDashboardOrderInput } from '@web/shared/api/types';

export function parseEditOrderFormData(formData: FormData): UpdateDashboardOrderInput {
  const symbol = formData.get('symbol')?.toString().trim() || undefined;
  const side = formData.get('side')?.toString() as 'long' | 'short' | undefined;
  const entryPriceRaw = formData.get('entryPrice')?.toString().trim();
  const volumeRaw = formData.get('volume')?.toString().trim();
  const openedAt = formData.get('openedAt')?.toString().trim() || undefined;
  const note = formData.get('note')?.toString().trim() || undefined;
  const exchange = formData.get('exchange')?.toString().trim() || undefined;
  const broker = formData.get('broker')?.toString().trim() || undefined;
  const orderType = (formData.get('orderType')?.toString().trim() as 'market' | 'limit' | undefined) || undefined;

  const closePriceRaw = formData.get('closePrice')?.toString().trim();

  const entryPrice = entryPriceRaw ? Number(entryPriceRaw) : undefined;
  const closePrice = closePriceRaw ? Number(closePriceRaw) : undefined;
  const volume = volumeRaw ? Number(volumeRaw) : undefined;
  const quantity = volume != null && entryPrice != null && entryPrice > 0
    ? volume / entryPrice
    : undefined;

  return { symbol, side, entryPrice, closePrice, quantity, openedAt, note, exchange, broker, orderType };
}

export async function submitEditOrder(orderId: string, input: UpdateDashboardOrderInput): Promise<DashboardOrder> {
  const client = createApiClient();
  return client.updateOrder(orderId, input);
}
