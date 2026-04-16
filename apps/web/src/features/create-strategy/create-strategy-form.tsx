'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { parseCreateStrategyFormData, submitCreateStrategy } from './create-strategy.model';

type CreateStrategyFormProps = Readonly<{
  onSubmitted?: () => void;
}>;

export function CreateStrategyForm({ onSubmitted }: CreateStrategyFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const parsed = parseCreateStrategyFormData(formData);
      await submitCreateStrategy(parsed);
      form.reset();

      startTransition(() => {
        onSubmitted?.();
        window.location.reload();
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to create strategy');
    }
  }

  return (
    <form className="trade-form" onSubmit={handleSubmit}>
      <label className="trade-field">
        <span>Name</span>
        <input name="name" type="text" placeholder="EMA Crossover" required />
      </label>

      <label className="trade-field">
        <span>Version</span>
        <input name="version" type="text" placeholder="1.0.0" defaultValue="1.0.0" required />
      </label>

      <label className="trade-field trade-field-wide">
        <span>Content</span>
        <textarea name="content" rows={6} placeholder="Describe the strategy rules, conditions, and logic..." required />
      </label>

      <label className="trade-field trade-field-wide">
        <span>Image References (one URL per line)</span>
        <textarea name="imageReference" rows={3} placeholder="https://example.com/chart.png" />
      </label>

      {error ? <p className="trade-form-error">{error}</p> : null}

      <button type="submit" className="trade-submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Strategy'}
      </button>
    </form>
  );
}
