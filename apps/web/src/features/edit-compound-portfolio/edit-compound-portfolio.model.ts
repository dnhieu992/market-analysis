import { createApiClient } from '@web/shared/api/client';
import type { CompoundPortfolio, UpdateCompoundPortfolioInput } from '@web/shared/api/types';

type EditCompoundPortfolioFormInput = {
  name?: string;
  description?: string;
};

export function parseEditCompoundPortfolioFormData(formData: FormData): EditCompoundPortfolioFormInput {
  return {
    name: formData.get('name')?.toString().trim() || undefined,
    description: formData.get('description')?.toString().trim() || undefined
  };
}

export async function submitEditCompoundPortfolio(id: string, input: EditCompoundPortfolioFormInput): Promise<CompoundPortfolio> {
  const payload: UpdateCompoundPortfolioInput = {
    name: input.name,
    description: input.description
  };
  return createApiClient().updateCompoundPortfolio(id, payload);
}
