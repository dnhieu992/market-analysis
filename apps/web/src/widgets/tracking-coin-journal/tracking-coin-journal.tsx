'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, useCallback } from 'react';
import { resolveApiBaseUrl } from '@web/shared/api/client';
import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false });

type JournalEntry = {
  id: string;
  date: string;
  content: string;
  updatedAt: string;
};

type Props = {
  symbol: string;
  name: string;
  onClose: () => void;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function TrackingCoinJournal({ symbol, name, onClose }: Props) {
  const [entries, setEntries]           = useState<JournalEntry[]>([]);
  const [loading, setLoading]           = useState(true);
  const [openDate, setOpenDate]         = useState<string | null>(todayIso());
  const [drafts, setDrafts]             = useState<Record<string, string>>({});
  const [saving, setSaving]             = useState<Record<string, boolean>>({});
  const [saved, setSaved]               = useState<Record<string, boolean>>({});

  const apiBase = resolveApiBaseUrl();

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/tracking-coins/coins/${symbol}/journal`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as JournalEntry[];
      setEntries(data);
      // seed drafts with saved content
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

  // Ensure today's entry is in the list (as an empty draft if not saved yet)
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

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'stretch',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          margin: 'auto',
          width: 'min(900px, 96vw)',
          maxHeight: '92vh',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.24)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.1rem 1.5rem',
          borderBottom: '1px solid #e5e7eb',
          background: '#f9fafb',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#111827' }}>📓 Journal</span>
              <span style={{ fontWeight: 700, color: '#4f46e5', fontSize: '1rem' }}>{symbol}</span>
              {name && <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{name}</span>}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.2rem' }}>
              Nhật ký phân tích · {entries.length} mục đã lưu
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: '#9ca3af', lineHeight: 1, padding: '0.25rem' }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>Đang tải…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {allDates.map((date) => {
                const entry = entries.find((e) => e.date === date);
                const isOpen = openDate === date;
                const draft = drafts[date] ?? '';
                const isToday = date === today;
                const isDirty = draft !== (entry?.content ?? '');

                return (
                  <div
                    key={date}
                    style={{
                      border: '1px solid',
                      borderColor: isOpen ? '#a5b4fc' : '#e5e7eb',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      transition: 'border-color 0.15s',
                    }}
                  >
                    {/* Collapse header */}
                    <button
                      onClick={() => setOpenDate(isOpen ? null : date)}
                      style={{
                        width: '100%', textAlign: 'left',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '0.75rem 1rem',
                        background: isOpen ? '#f5f3ff' : '#fafafa',
                        border: 'none', cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#111827' }}>
                          {formatDate(date)}
                        </span>
                        {isToday && (
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 600,
                            padding: '0.1rem 0.45rem', borderRadius: '4px',
                            background: '#dbeafe', color: '#1d4ed8',
                          }}>Hôm nay</span>
                        )}
                        {!entry && (
                          <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>chưa có ghi chú</span>
                        )}
                        {isDirty && !saving[date] && (
                          <span style={{ fontSize: '0.7rem', color: '#f59e0b' }}>● chưa lưu</span>
                        )}
                        {saved[date] && (
                          <span style={{ fontSize: '0.7rem', color: '#16a34a' }}>✓ đã lưu</span>
                        )}
                      </div>
                      <span style={{ fontSize: '0.9rem', color: '#6b7280', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                        ▾
                      </span>
                    </button>

                    {/* Editor */}
                    {isOpen && (
                      <div style={{ padding: '1rem', background: '#ffffff' }}>
                        <div data-color-mode="light">
                          <MDEditor
                            value={draft}
                            onChange={(val) => setDrafts((d) => ({ ...d, [date]: val ?? '' }))}
                            height={320}
                            preview="live"
                            visibleDragbar={false}
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem', gap: '0.5rem', alignItems: 'center' }}>
                          {entry && (
                            <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                              Cập nhật: {new Date(entry.updatedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                            </span>
                          )}
                          <button
                            onClick={() => void handleSave(date)}
                            disabled={saving[date] || !isDirty}
                            style={{
                              padding: '0.45rem 1.1rem',
                              background: isDirty ? '#4f46e5' : '#e5e7eb',
                              color: isDirty ? '#fff' : '#9ca3af',
                              border: 'none', borderRadius: '8px',
                              cursor: isDirty ? 'pointer' : 'default',
                              fontWeight: 600, fontSize: '0.85rem',
                              opacity: saving[date] ? 0.6 : 1,
                            }}
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
          )}
        </div>
      </div>
    </div>
  );
}
