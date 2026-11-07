'use client';

import { useMemo, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { JunkShortCoin } from '@web/shared/api/types';

import styles from './junk-coins.module.css';

const api = createApiClient();

/** `ordi, PIVX/USDT\nsui_usdt` → ['ORDIUSDT', 'PIVXUSDT', 'SUIUSDT'] (dedup, USDT appended). */
export function parseSymbols(raw: string): string[] {
  const out = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase().replace(/[_/-]/g, ''))
    .filter(Boolean)
    .map((s) => (s.endsWith('USDT') ? s : `${s}USDT`));
  return [...new Set(out)];
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** The /short-junk coin list: add many at once, click a note to edit, delete per row. */
export function JunkCoinsManager({ coins, onChange }: { coins: JunkShortCoin[]; onChange: (coins: JunkShortCoin[]) => void }) {
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ symbol: string; draft: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const parsed = useMemo(() => parseSymbols(raw), [raw]);
  const fresh = parsed.filter((s) => !coins.some((c) => c.symbol === s));
  const q = query.trim().toUpperCase();
  const shown = q ? coins.filter((c) => c.symbol.includes(q) || (c.note ?? '').toUpperCase().includes(q)) : coins;

  const merge = (rows: JunkShortCoin[]) => {
    const map = new Map(coins.map((c) => [c.symbol, c]));
    for (const r of rows) map.set(r.symbol, r);
    onChange([...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)));
  };

  const add = async () => {
    if (parsed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api.addJunkCoins(parsed, note || undefined);
      merge(res.added);
      setRaw('');
      setNote('');
      const parts = [`Đã lưu ${res.added.length} coin.`];
      if (res.rejected.length) parts.push(`Bỏ qua (không có futures USDT-M trên Binance): ${res.rejected.join(', ')}.`);
      setInfo(parts.join(' '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thêm coin thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!editing) return;
    const { symbol, draft } = editing;
    const old = coins.find((c) => c.symbol === symbol)?.note ?? '';
    setEditing(null);
    if (draft.trim() === old.trim()) return;
    setRowBusy(symbol);
    setError(null);
    try {
      merge([await api.updateJunkCoin(symbol, draft)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu ghi chú thất bại.');
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (symbol: string) => {
    if (rowBusy || !window.confirm(`Xoá ${symbol} khỏi danh sách coin rác? Skill sẽ không scan coin này nữa.`)) return;
    setRowBusy(symbol);
    setError(null);
    try {
      await api.deleteJunkCoin(symbol);
      onChange(coins.filter((c) => c.symbol !== symbol));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xoá coin thất bại.');
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Thêm coin</h2>
        <div className={styles.addRow}>
          <textarea
            value={raw}
            placeholder="Mã coin, cách nhau bằng dấu phẩy / xuống dòng — vd: ORDI, ATM, PIVX"
            onChange={(e) => {
              setRaw(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add();
            }}
          />
          <input type="text" value={note} placeholder="Ghi chú (tuỳ chọn, áp cho các coin vừa thêm)" onChange={(e) => setNote(e.target.value)} />
          <div className={styles.addActions}>
            <span className={styles.hint}>
              {parsed.length === 0
                ? 'Không cần gõ đuôi USDT. Chỉ nhận coin có futures USDT-M trên Binance.'
                : `${parsed.length} mã · ${fresh.length} mới${parsed.length > fresh.length ? ` · ${parsed.length - fresh.length} đã có (cập nhật ghi chú nếu có)` : ''}`}
            </span>
            <button type="button" className={styles.primaryBtn} disabled={parsed.length === 0 || busy} onClick={() => void add()}>
              {busy ? 'Đang thêm…' : 'Thêm'}
            </button>
          </div>
        </div>
        {error && <div className="bg-alert bg-alert--error">{error}</div>}
        {info && <div className="bg-alert">{info}</div>}
      </section>

      <section className={styles.card}>
        <div className={styles.listHead}>
          <h2 className={styles.cardTitle}>Danh sách coin rác ({coins.length})</h2>
          {coins.length > 0 && (
            <input className={styles.searchInput} type="text" value={query} placeholder="Tìm coin / ghi chú…" onChange={(e) => setQuery(e.target.value)} />
          )}
        </div>

        {coins.length === 0 ? (
          <p className={styles.empty}>Chưa có coin nào — skill sẽ không có gì để scan.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Ghi chú</th>
                  <th className={styles.date}>Ngày thêm</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.symbol}>
                    <td className={styles.sym}>{c.symbol.replace(/USDT$/, '')}</td>
                    <td>
                      {editing?.symbol === c.symbol ? (
                        <textarea
                          className={styles.noteInput}
                          value={editing.draft}
                          autoFocus
                          rows={2}
                          onChange={(e) => setEditing({ symbol: c.symbol, draft: e.target.value })}
                          onBlur={() => void saveNote()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              void saveNote();
                            }
                            if (e.key === 'Escape') setEditing(null);
                          }}
                        />
                      ) : (
                        <div
                          className={`${styles.note} ${c.note ? '' : styles.noteEmpty}`}
                          onClick={() => setEditing({ symbol: c.symbol, draft: c.note ?? '' })}
                          title="Bấm để sửa ghi chú"
                        >
                          {c.note || 'thêm ghi chú…'}
                        </div>
                      )}
                    </td>
                    <td className={styles.date}>{fmtDate(c.createdAt)}</td>
                    <td className={styles.rowActions}>
                      <button
                        type="button"
                        className={`${styles.linkBtn} ${styles.linkBtnDanger}`}
                        disabled={rowBusy === c.symbol}
                        onClick={() => void remove(c.symbol)}
                      >
                        {rowBusy === c.symbol ? '…' : 'Xoá'}
                      </button>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.empty}>Không tìm thấy.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
