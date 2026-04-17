import { createApiClient } from '@web/shared/api/client';
import type { CreatePortfolioInput, Portfolio } from '@web/shared/api/types';

type CreatePortfolioFormInput = {
  name: string;
  description?: string;
};

function requireText(value: FormDataEntryValue | null, fieldName: string): string {
  const normalized = value?.toString().trim() ?? '';
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

export function parseCreatePortfolioFormData(formData: FormData): CreatePortfolioFormInput {
  return {
    name: requireText(formData.get('name'), 'Name'),
    description: formData.get('description')?.toString().trim() || undefined
  };
}

export async function submitCreatePortfolio(input: CreatePortfolioFormInput): Promise<Portfolio> {
  const payload: CreatePortfolioInput = {
    name: input.name,
    description: input.description
  };
  return createApiClient().createPortfolio(payload);
}
