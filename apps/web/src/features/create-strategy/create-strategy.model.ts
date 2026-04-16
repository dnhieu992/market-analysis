import { createApiClient } from '@web/shared/api/client';
import type { CreateTradingStrategyInput, TradingStrategy } from '@web/shared/api/types';

type StrategyFormInput = {
  name: string;
  content: string;
  imageReference: string[];
  version: string;
};

function requireText(value: FormDataEntryValue | null, fieldName: string): string {
  const normalized = value?.toString().trim() ?? '';

  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}

export function parseCreateStrategyFormData(formData: FormData): StrategyFormInput {
  const name = requireText(formData.get('name'), 'Name');
  const content = requireText(formData.get('content'), 'Content');
  const version = requireText(formData.get('version'), 'Version');
  const imageReferenceRaw = formData.get('imageReference')?.toString().trim() ?? '';
  const imageReference = imageReferenceRaw
    ? imageReferenceRaw.split('\n').map((s) => s.trim()).filter(Boolean)
    : [];

  return { name, content, imageReference, version };
}

export async function submitCreateStrategy(input: StrategyFormInput): Promise<TradingStrategy> {
  const client = createApiClient();
  const payload: CreateTradingStrategyInput = {
    name: input.name,
    content: input.content,
    imageReference: input.imageReference,
    version: input.version
  };
  return client.createTradingStrategy(payload);
}
