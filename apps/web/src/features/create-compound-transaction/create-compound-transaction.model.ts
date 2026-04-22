import { createApiClient } from '@web/shared/api/client';
import type { CompoundTransaction, CreateCompoundTransactionInput } from '@web/shared/api/types';

type TransactionFormInput = {
  coinId: string;
  type: 'buy' | 'sell';
  amount: string;
  price: string;
  transactedAt?: string;
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

export function parseCreateCompoundTransactionFormData(formData: FormData): TransactionFormInput {
  const type = requireText(formData.get('type'), 'Type');
  if (type !== 'buy' && type !== 'sell') throw new Error('Type must be buy or sell');

  return {
    coinId: requireText(formData.get('coinId'), 'Coin').toUpperCase(),
    type,
    amount: requireText(formData.get('amount'), 'Amount'),
    price: requireText(formData.get('price'), 'Price'),
    transactedAt: formData.get('transactedAt')?.toString().trim() || undefined
  };
}

export async function submitCreateCompoundTransaction(portfolioId: string, input: TransactionFormInput): Promise<CompoundTransaction> {
  const payload: CreateCompoundTransactionInput = {
    coinId: input.coinId,
    type: input.type,
    amount: toPositiveNumber(input.amount, 'Amount'),
    price: toPositiveNumber(input.price, 'Price'),
    transactedAt: input.transactedAt
  };
  return createApiClient().createCompoundTransaction(portfolioId, payload);
}
