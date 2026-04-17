import { createApiClient } from '@web/shared/api/client';
import type { CoinTransaction, CreateTransactionInput } from '@web/shared/api/types';

type TransactionFormInput = {
  coinId: string;
  type: 'BUY' | 'SELL';
  amount: string;
  price: string;
  date?: string;
};

function requireText(value: FormDataEntryValue | null, fieldName: string): string {
  const normalized = value?.toString().trim() ?? '';
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

function toPositiveNumber(value: string, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${fieldName} must be a positive number`);
  return parsed;
}

export function parseCreateTransactionFormData(formData: FormData): TransactionFormInput {
  const type = requireText(formData.get('type'), 'Type');
  if (type !== 'BUY' && type !== 'SELL') throw new Error('Type must be BUY or SELL');

  return {
    coinId: requireText(formData.get('coinId'), 'Coin').toUpperCase(),
    type,
    amount: requireText(formData.get('amount'), 'Amount'),
    price: requireText(formData.get('price'), 'Price'),
    date: formData.get('date')?.toString().trim() || undefined
  };
}

export async function submitCreateTransaction(portfolioId: string, input: TransactionFormInput): Promise<CoinTransaction> {
  const payload: CreateTransactionInput = {
    coinId: input.coinId,
    type: input.type,
    amount: toPositiveNumber(input.amount, 'Amount'),
    price: toPositiveNumber(input.price, 'Price'),
    date: input.date
  };
  return createApiClient().createTransaction(portfolioId, payload);
}
