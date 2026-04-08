'use client';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createApiClient } from '@web/shared/api/client';

const apiClient = createApiClient();

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await apiClient.login({
        email,
        password
      });
      startTransition(() => {
        router.replace('/');
        router.refresh();
      });
    } catch {
      setError('Invalid email or password');
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Secure Access</p>
        <h1>Login to Market Analysis</h1>
        <p className="lead">Use your account to access the dashboard and protected API routes.</p>
        <form className="login-form" onSubmit={(event) => { void handleSubmit(event); }}>
          <label className="settings-label" htmlFor="email">Email</label>
          <input
            id="email"
            className="settings-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label className="settings-label" htmlFor="password">Password</label>
          <input
            id="password"
            className="settings-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <button className="btn btn--primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>

          {error ? <p className="settings-status settings-status--error">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}
