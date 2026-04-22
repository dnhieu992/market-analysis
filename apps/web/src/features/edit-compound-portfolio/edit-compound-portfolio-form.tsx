'use client';

import { useState, useTransition, type FormEvent } from 'react';

import type { CompoundPortfolio } from '@web/shared/api/types';
import { parseEditCompoundPortfolioFormData, submitEditCompoundPortfolio } from './edit-compound-portfolio.model';

type EditCompoundPortfolioFormProps = Readonly<{
  portfolio: CompoundPortfolio;
  onSubmitted?: () => void;
}>;

export function EditCompoundPortfolioForm({ portfolio, onSubmitted }: EditCompoundPortfolioFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const formData = new FormData(event.currentTarget);
      const parsed = parseEditCompoundPortfolioFormData(formData);
      await submitEditCompoundPortfolio(portfolio.id, parsed);
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
