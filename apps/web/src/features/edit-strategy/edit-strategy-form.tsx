'use client';

import { useState, useTransition, type FormEvent } from 'react';

import type { TradingStrategy } from '@web/shared/api/types';

import { parseEditStrategyFormData, submitEditStrategy } from './edit-strategy.model';

type EditStrategyFormProps = Readonly<{
  strategy: TradingStrategy;
  onSubmitted?: () => void;
}>;

export function EditStrategyForm({ strategy, onSubmitted }: EditStrategyFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const parsed = parseEditStrategyFormData(formData);
      await submitEditStrategy(strategy.id, parsed);

      startTransition(() => {
        onSubmitted?.();
        window.location.reload();
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to update strategy');
    }
  }

  return (
    <form className="trade-form" onSubmit={handleSubmit}>
      <label className="trade-field">
        <span>Name</span>
        <input name="name" type="text" defaultValue={strategy.name} required />
      </label>

      <label className="trade-field">
        <span>Version</span>
        <input name="version" type="text" defaultValue={strategy.version} required />
      </label>

      <label className="trade-field trade-field-wide">
        <span>Content</span>
        <textarea name="content" rows={6} defaultValue={strategy.content} required />
      </label>

      <label className="trade-field trade-field-wide">
        <span>Image References (one URL per line)</span>
        <textarea name="imageReference" rows={3} defaultValue={strategy.imageReference.join('\n')} />
      </label>

      {error ? <p className="trade-form-error">{error}</p> : null}

      <button type="submit" className="trade-submit" disabled={isPending}>
        {isPending ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}
