import { createApiClient } from '@web/shared/api/client';
import type { Portfolio, UpdatePortfolioInput } from '@web/shared/api/types';

type EditPortfolioFormInput = {
  name: string;
  description?: string;
};

function requireText(value: FormDataEntryValue | null, fieldName: string): string {
  const normalized = value?.toString().trim() ?? '';
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

export function parseEditPortfolioFormData(formData: FormData): EditPortfolioFormInput {
  return {
    name: requireText(formData.get('name'), 'Name'),
    description: formData.get('description')?.toString().trim() || undefined
  };
}

export async function submitEditPortfolio(portfolioId: string, input: EditPortfolioFormInput): Promise<Portfolio> {
  const payload: UpdatePortfolioInput = {
    name: input.name,
    description: input.description
  };
  return createApiClient().updatePortfolio(portfolioId, payload);
}
