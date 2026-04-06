'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { TrackingSettings } from '@web/shared/api/types';

const apiClient = createApiClient();

type SettingsFeedProps = Readonly<{
  initial: TrackingSettings | null;
}>;

export function SettingsFeed({ initial }: SettingsFeedProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [symbols, setSymbols] = useState<string[]>(initial?.trackingSymbols ?? []);
  const [symbolInput, setSymbolInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

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
      await apiClient.upsertSettings({ name, trackingSymbols: symbols });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <main className="dashboard-shell settings-shell">
      <section className="hero-card settings-hero">
        <div className="hero-copy">
          <p className="eyebrow">Settings</p>
          <h1>Tracking Settings</h1>
          <p className="lead">Configure the symbols you want to track continuously.</p>
        </div>
      </section>

      <section className="settings-card">
        <p className="settings-card-title">Watchlist</p>

        <div className="settings-fields">
          <div className="settings-field">
            <label htmlFor="settings-name" className="settings-label">Name</label>
            <input
              id="settings-name"
              className="settings-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Watchlist"
            />
          </div>

          <hr className="settings-divider" />

          <div className="settings-field">
            <label htmlFor="settings-symbol-input" className="settings-label">Tracking Symbols</label>
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
                id="settings-symbol-input"
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
              {status === 'saving' ? 'Saving…' : 'Save settings'}
            </button>
            {status === 'saved' && <span className="settings-status settings-status--success">✓ Saved</span>}
            {status === 'error' && <span className="settings-status settings-status--error">Failed to save</span>}
          </div>
        </div>
      </section>
    </main>
  );
}
