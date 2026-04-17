'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { parseCreatePortfolioFormData, submitCreatePortfolio } from './create-portfolio.model';

type CreatePortfolioFormProps = Readonly<{
  onSubmitted?: () => void;
}>;

export function CreatePortfolioForm({ onSubmitted }: CreatePortfolioFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const parsed = parseCreatePortfolioFormData(formData);
      await submitCreatePortfolio(parsed);
      form.reset();
      startTransition(() => {
        onSubmitted?.();
        window.location.reload();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create portfolio');
    }
  }

  return (
    <form className="trade-form" onSubmit={handleSubmit}>
      <label className="trade-field">
        <span>Name</span>
        <input name="name" type="text" placeholder="My BTC Portfolio" required />
      </label>

      <label className="trade-field trade-field-wide">
        <span>Description</span>
        <textarea name="description" rows={3} placeholder="Optional notes about this portfolio" />
      </label>

      {error ? <p className="trade-form-error">{error}</p> : null}

      <button type="submit" className="trade-submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Portfolio'}
      </button>
    </form>
  );
}
