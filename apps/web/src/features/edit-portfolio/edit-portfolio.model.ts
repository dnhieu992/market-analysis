import { createApiClient } from '@web/shared/api/client';
import type { Portfolio, UpdatePortfolioInput } from '@web/shared/api/types';

type EditPortfolioFormInput = {
  name: string;
  description?: string;
  totalCapital?: number;
};

function requireText(value: FormDataEntryValue | null, fieldName: string): string {
  const normalized = value?.toString().trim() ?? '';
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

export function parseEditPortfolioFormData(formData: FormData): EditPortfolioFormInput {
  const capitalStr = formData.get('totalCapital')?.toString().trim();
  const totalCapital = capitalStr ? Number(capitalStr) : undefined;
  return {
    name: requireText(formData.get('name'), 'Name'),
    description: formData.get('description')?.toString().trim() || undefined,
    totalCapital: totalCapital && totalCapital > 0 ? totalCapital : undefined
  };
}

export async function submitEditPortfolio(portfolioId: string, input: EditPortfolioFormInput): Promise<Portfolio> {
  const payload: UpdatePortfolioInput = {
    name: input.name,
    description: input.description,
    totalCapital: input.totalCapital
  };
  return createApiClient().updatePortfolio(portfolioId, payload);
}
