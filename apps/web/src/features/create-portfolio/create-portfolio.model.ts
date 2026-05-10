import { createApiClient } from '@web/shared/api/client';
import type { CreatePortfolioInput, Portfolio } from '@web/shared/api/types';

type CreatePortfolioFormInput = {
  name: string;
  description?: string;
  totalCapital?: number;
};

function requireText(value: FormDataEntryValue | null, fieldName: string): string {
  const normalized = value?.toString().trim() ?? '';
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

export function parseCreatePortfolioFormData(formData: FormData): CreatePortfolioFormInput {
  const capitalStr = formData.get('totalCapital')?.toString().trim();
  const totalCapital = capitalStr ? Number(capitalStr) : undefined;
  return {
    name: requireText(formData.get('name'), 'Name'),
    description: formData.get('description')?.toString().trim() || undefined,
    totalCapital: totalCapital && totalCapital > 0 ? totalCapital : undefined
  };
}

export async function submitCreatePortfolio(input: CreatePortfolioFormInput): Promise<Portfolio> {
  const payload: CreatePortfolioInput = {
    name: input.name,
    description: input.description,
    totalCapital: input.totalCapital
  };
  return createApiClient().createPortfolio(payload);
}
