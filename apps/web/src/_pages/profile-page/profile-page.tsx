'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { UserProfile } from '@web/shared/api/types';

const apiClient = createApiClient();

type ProfilePageProps = Readonly<{
  initial: UserProfile | null;
}>;

export function ProfilePage({ initial }: ProfilePageProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [symbols, setSymbols] = useState<string[]>(initial?.symbolsTracking ?? []);
  const [symbolInput, setSymbolInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const initials = (initial?.name ?? '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  function handleAddSymbol() {
    const trimmed = symbolInput.trim().toUpperCase();
    if (!trimmed || symbols.includes(trimmed)) return;
    setSymbols([...symbols, trimmed]);
    setSymbolInput('');
  }

  function handleRemoveSymbol(index: number) {
    setSymbols(symbols.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setStatus('saving');
    try {
      await apiClient.updateUserProfile({ name, symbolsTracking: symbols });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <main className="dashboard-shell settings-shell">
      <section className="hero-card settings-hero">
        <div className="hero-copy">
          <p className="eyebrow">Account</p>
          <h1>Profile</h1>
          <p className="lead">Manage your account info and swing signal watchlist.</p>
        </div>
      </section>

      <section className="settings-card">
        <p className="settings-card-title">Account Info</p>

        <div className="settings-fields">
          <div className="profile-avatar">{initials}</div>

          <div className="settings-field">
            <label className="settings-label">Email</label>
            <p className="settings-value">{initial?.email ?? '—'}</p>
          </div>

          <div className="settings-field">
            <label htmlFor="profile-name" className="settings-label">Display Name</label>
            <input
              id="profile-name"
              className="settings-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <hr className="settings-divider" />

          <div className="settings-field">
            <label htmlFor="profile-symbol-input" className="settings-label">Swing Signal Watchlist</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Worker will alert you on Telegram when RSI(14) H4 ≤ 30 for these symbols.
            </p>
            <div className="settings-symbol-list">
              {symbols.length === 0
                ? <span className="settings-symbol-list-empty">No symbols yet — add one below</span>
                : symbols.map((sym, i) => (
                    <span key={sym} className="settings-symbol-tag">
                      {sym}
                      <button
                        className="settings-symbol-remove"
                        onClick={() => handleRemoveSymbol(i)}
                        aria-label={`Remove ${sym}`}
                      >
                        ×
                      </button>
                    </span>
                  ))
              }
            </div>
            <div className="settings-symbol-add">
              <input
                id="profile-symbol-input"
                className="settings-input"
                type="text"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddSymbol(); }}
                placeholder="e.g. BTCUSDT"
              />
              <button className="btn btn--secondary" onClick={handleAddSymbol}>Add</button>
            </div>
          </div>

          <hr className="settings-divider" />

          <div className="settings-actions">
            <button
              className="btn btn--primary"
              onClick={() => { void handleSave(); }}
              disabled={status === 'saving'}
            >
              {status === 'saving' ? 'Saving…' : 'Save profile'}
            </button>
            {status === 'saved' && <span className="settings-status settings-status--success">✓ Saved</span>}
            {status === 'error' && <span className="settings-status settings-status--error">Failed to save</span>}
          </div>
        </div>
      </section>
    </main>
  );
}
