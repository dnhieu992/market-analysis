'use client';

import { useState, useTransition, type FormEvent } from 'react';

import type { Portfolio } from '@web/shared/api/types';

import { parseEditPortfolioFormData, submitEditPortfolio } from './edit-portfolio.model';

type EditPortfolioFormProps = Readonly<{
  portfolio: Portfolio;
  onSubmitted?: () => void;
}>;

export function EditPortfolioForm({ portfolio, onSubmitted }: EditPortfolioFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const formData = new FormData(event.currentTarget);
      const parsed = parseEditPortfolioFormData(formData);
      await submitEditPortfolio(portfolio.id, parsed);
      startTransition(() => {
        onSubmitted?.();
        window.location.reload();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update portfolio');
    }
  }

  return (
    <form className="trade-form" onSubmit={handleSubmit}>
      <label className="trade-field">
        <span>Name</span>
        <input name="name" type="text" defaultValue={portfolio.name} required />
      </label>

      <label className="trade-field trade-field-wide">
        <span>Description</span>
        <textarea name="description" rows={3} defaultValue={portfolio.description ?? ''} />
      </label>

      {error ? <p className="trade-form-error">{error}</p> : null}

      <button type="submit" className="trade-submit" disabled={isPending}>
        {isPending ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}
