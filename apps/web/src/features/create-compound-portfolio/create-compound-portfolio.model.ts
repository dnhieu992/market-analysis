import { createApiClient } from '@web/shared/api/client';
import type { CompoundPortfolio, CreateCompoundPortfolioInput } from '@web/shared/api/types';

type CreateCompoundPortfolioFormInput = {
  name: string;
  description?: string;
};

function requireText(value: FormDataEntryValue | null, fieldName: string): string {
  const normalized = value?.toString().trim() ?? '';
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

export function parseCreateCompoundPortfolioFormData(formData: FormData): CreateCompoundPortfolioFormInput {
  return {
    name: requireText(formData.get('name'), 'Name'),
    description: formData.get('description')?.toString().trim() || undefined
  };
}

export async function submitCreateCompoundPortfolio(input: CreateCompoundPortfolioFormInput): Promise<CompoundPortfolio> {
  const payload: CreateCompoundPortfolioInput = {
    name: input.name,
    description: input.description
  };
  return createApiClient().createCompoundPortfolio(payload);
}
