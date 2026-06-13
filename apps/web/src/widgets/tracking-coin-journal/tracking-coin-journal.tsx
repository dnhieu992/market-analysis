'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, useCallback } from 'react';
import { resolveApiBaseUrl } from '@web/shared/api/client';

// Lazy-load the TipTap editor so its bundle only loads when a journal opens.
const MarkdownEditor = dynamic(
  () => import('@web/shared/ui/markdown-editor/markdown-editor').then((m) => m.MarkdownEditor),
  { ssr: false },
);

type JournalEntry = {
  id: string;
  date: string;
  content: string;
  updatedAt: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Journal content panel — designed to be embedded (e.g. inside the coin detail
 * dialog's "Journal" tab). It owns its own data fetching keyed by `symbol`.
 */
export function CoinJournalPanel({ symbol }: { symbol: string }) {
  const [entries, setEntries]   = useState<JournalEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [openDate, setOpenDate] = useState<string | null>(todayIso());
  const [drafts, setDrafts]     = useState<Record<string, string>>({});
  const [saving, setSaving]     = useState<Record<string, boolean>>({});
  const [saved, setSaved]       = useState<Record<string, boolean>>({});

  const apiBase = resolveApiBaseUrl();

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/tracking-coins/coins/${symbol}/journal`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as JournalEntry[];
      setEntries(data);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const e of data) {
          if (!(e.date in next)) next[e.date] = e.content;
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [apiBase, symbol]);

  useEffect(() => { void fetchEntries(); }, [fetchEntries]);

  const today = todayIso();
  const allDates = Array.from(new Set([today, ...entries.map((e) => e.date)])).sort((a, b) => b.localeCompare(a));

  async function handleSave(date: string) {
    const content = drafts[date] ?? '';
    setSaving((s) => ({ ...s, [date]: true }));
    try {
      const res = await fetch(`${apiBase}/tracking-coins/coins/${symbol}/journal`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, content }),
      });
      if (res.ok) {
        const entry = await res.json() as JournalEntry;
        setEntries((prev) => {
          const exists = prev.find((e) => e.date === date);
          return exists
            ? prev.map((e) => (e.date === date ? entry : e))
            : [entry, ...prev].sort((a, b) => b.date.localeCompare(a.date));
        });
        setSaved((s) => ({ ...s, [date]: true }));
        setTimeout(() => setSaved((s) => ({ ...s, [date]: false })), 2000);
      }
    } finally {
      setSaving((s) => ({ ...s, [date]: false }));
    }
  }

  if (loading) {
    return <div className="jrn-loading">Đang tải…</div>;
  }

  return (
    <div className="jrn-panel">
      {allDates.map((date) => {
        const entry = entries.find((e) => e.date === date);
        const isOpen = openDate === date;
        const draft = drafts[date] ?? '';
        const isToday = date === today;
        const isDirty = draft !== (entry?.content ?? '');

        return (
          <div key={date} className={`jrn-entry${isOpen ? ' jrn-entry--open' : ''}`}>
            <button className="jrn-entry__head" onClick={() => setOpenDate(isOpen ? null : date)}>
              <span className="jrn-entry__meta">
                <span className="jrn-entry__date">{formatDate(date)}</span>
                {isToday && <span className="jrn-badge jrn-badge--today">Hôm nay</span>}
                {!entry && <span className="jrn-entry__hint">chưa có ghi chú</span>}
                {isDirty && !saving[date] && <span className="jrn-entry__dirty">● chưa lưu</span>}
                {saved[date] && <span className="jrn-entry__saved">✓ đã lưu</span>}
              </span>
              <span className="jrn-entry__chevron">▾</span>
            </button>

            {isOpen && (
              <div className="jrn-entry__body">
                <MarkdownEditor
                  value={draft}
                  onChange={(val) => setDrafts((d) => ({ ...d, [date]: val }))}
                  minHeight={260}
                  placeholder="Viết ghi chú phân tích…"
                />
                <div className="jrn-entry__actions">
                  {entry && (
                    <span className="jrn-entry__updated">
                      Cập nhật: {new Date(entry.updatedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                    </span>
                  )}
                  <button
                    className="jrn-save-btn"
                    onClick={() => void handleSave(date)}
                    disabled={saving[date] || !isDirty}
                  >
                    {saving[date] ? 'Đang lưu…' : 'Lưu'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
