'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

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
const bySymbol = (a: JunkShortCoin, b: JunkShortCoin) => a.symbol.localeCompare(b.symbol);

type Banner = { kind: 'info' | 'error'; text: string; stale?: string[] };

/** The /short-junk coin list: toolbar (add dialog · Binance sync · search) + table (edit note · delete). */
export function JunkCoinsManager({ coins, onChange }: { coins: JunkShortCoin[]; onChange: (coins: JunkShortCoin[]) => void }) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ symbol: string; draft: string } | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  const q = query.trim().toUpperCase();
  const shown = q ? coins.filter((c) => c.symbol.includes(q) || (c.note ?? '').toUpperCase().includes(q)) : coins;

  const merge = (rows: JunkShortCoin[]) => {
    const map = new Map(coins.map((c) => [c.symbol, c]));
    for (const r of rows) map.set(r.symbol, r);
    onChange([...map.values()].sort(bySymbol));
  };

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    setBanner(null);
    try {
      const r = await api.syncJunkCoins();
      onChange([...r.coins].sort(bySymbol));
      setBanner({
        kind: 'info',
        text:
          `Đã quét ${r.scanned} coin futures Binance · ${r.junk} coin đạt tiêu chí coin rác · thêm mới ${r.added.length}` +
          (r.added.length ? ` (${r.added.slice(0, 12).map((s) => s.replace(/USDT$/, '')).join(', ')}${r.added.length > 12 ? '…' : ''})` : '') +
          '.',
        stale: r.noLongerJunk,
      });
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Sync từ Binance thất bại.' });
    } finally {
      setSyncing(false);
    }
  };

  const removeMany = async (symbols: string[]) => {
    if (!window.confirm(`Xoá ${symbols.length} coin không còn đạt tiêu chí coin rác khỏi danh sách?`)) return;
    setBanner(null);
    const gone: string[] = [];
    for (const s of symbols) {
      try {
        await api.deleteJunkCoin(s);
        gone.push(s);
      } catch {
        /* keep it — reported below */
      }
    }
    onChange(coins.filter((c) => !gone.includes(c.symbol)));
    setBanner({ kind: gone.length === symbols.length ? 'info' : 'error', text: `Đã xoá ${gone.length}/${symbols.length} coin.` });
  };

  const saveNote = async () => {
    if (!editing) return;
    const { symbol, draft } = editing;
    const old = coins.find((c) => c.symbol === symbol)?.note ?? '';
    setEditing(null);
    if (draft.trim() === old.trim()) return;
    setRowBusy(symbol);
    try {
      merge([await api.updateJunkCoin(symbol, draft)]);
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Lưu ghi chú thất bại.' });
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (symbol: string) => {
    if (rowBusy || !window.confirm(`Xoá ${symbol} khỏi danh sách coin rác? Skill sẽ không scan coin này nữa.`)) return;
    setRowBusy(symbol);
    try {
      await api.deleteJunkCoin(symbol);
      onChange(coins.filter((c) => c.symbol !== symbol));
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Xoá coin thất bại.' });
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <section className={styles.card}>
      <div className={styles.toolbar}>
        <h2 className={styles.cardTitle}>Danh sách coin rác ({coins.length})</h2>
        <div className={styles.toolbarActions}>
          {coins.length > 0 && (
            <input className={styles.searchInput} type="search" value={query} placeholder="Tìm coin / ghi chú…" onChange={(e) => setQuery(e.target.value)} />
          )}
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void sync()}
            disabled={syncing}
            title="Quét toàn bộ futures USDT-M Binance theo tiêu chí coin rác (spot + futures, list ≥ 90 ngày, vốn hoá $20–500M, ≥ 50% dưới ATH) và thêm coin chưa có. Không xoá coin nào."
          >
            {syncing ? 'Đang quét Binance…' : '⟳ Sync từ Binance'}
          </button>
          <button type="button" className={styles.primaryBtn} onClick={() => setAdding(true)}>
            + Thêm coin
          </button>
        </div>
      </div>

      {banner && (
        <div className={`bg-alert ${banner.kind === 'error' ? 'bg-alert--error' : ''} ${styles.banner}`}>
          <span>{banner.text}</span>
          {banner.stale && banner.stale.length > 0 && (
            <span>
              {' '}
              {banner.stale.length} coin đã sync trước đây không còn đạt tiêu chí: {banner.stale.map((s) => s.replace(/USDT$/, '')).join(', ')}.{' '}
              <button type="button" className={`${styles.linkBtn} ${styles.linkBtnDanger}`} onClick={() => void removeMany(banner.stale!)}>
                Xoá các coin này
              </button>
            </span>
          )}
          <button type="button" className={styles.bannerX} onClick={() => setBanner(null)} aria-label="Đóng">×</button>
        </div>
      )}

      {coins.length === 0 ? (
        <p className={styles.empty}>
          Chưa có coin nào — bấm <strong>⟳ Sync từ Binance</strong> để lấy toàn bộ coin rác theo tiêu chí nghiên cứu, hoặc <strong>+ Thêm coin</strong> để tự thêm.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Coin</th>
                <th>Ghi chú</th>
                <th className={styles.date}>Nguồn</th>
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
                  <td className={styles.date}>
                    <span className={`${styles.badge} ${c.source === 'BINANCE_SYNC' ? styles.badgeSync : ''}`}>
                      {c.source === 'BINANCE_SYNC' ? 'Binance' : 'Tự thêm'}
                    </span>
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
                  <td colSpan={5} className={styles.empty}>Không tìm thấy.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddCoinsDialog
          coins={coins}
          onClose={() => setAdding(false)}
          onAdded={(rows, rejected) => {
            merge(rows);
            setAdding(false);
            setBanner({
              kind: rejected.length ? 'error' : 'info',
              text:
                `Đã lưu ${rows.length} coin.` +
                (rejected.length ? ` Bỏ qua (không có futures USDT-M trên Binance): ${rejected.join(', ')}.` : ''),
            });
          }}
        />
      )}
    </section>
  );
}

function AddCoinsDialog({
  coins,
  onClose,
  onAdded,
}: {
  coins: JunkShortCoin[];
  onClose: () => void;
  onAdded: (rows: JunkShortCoin[], rejected: string[]) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsed = useMemo(() => parseSymbols(raw), [raw]);
  const fresh = parsed.filter((s) => !coins.some((c) => c.symbol === s));

  const submit = async () => {
    if (parsed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.addJunkCoins(parsed, note || undefined);
      onAdded(res.added, res.rejected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thêm coin thất bại.');
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div className={`bg-setup-dialog ${styles.dialog}`} role="dialog" aria-modal="true" aria-label="Thêm coin rác" onClick={(e) => e.stopPropagation()}>
        <div className="bg-setup-head">
          <h3>Thêm coin rác</h3>
          <button type="button" className="bg-setup-x" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="bg-setup-body">
          <label className="bg-setup-field">
            <span>Mã coin</span>
            <textarea
              className={styles.noteInput}
              rows={3}
              value={raw}
              placeholder="ORDI, ATM, PIVX — dấu phẩy hoặc xuống dòng"
              autoFocus
              onChange={(e) => {
                setRaw(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
              }}
            />
          </label>
          <label className="bg-setup-field">
            <span>Ghi chú (tuỳ chọn)</span>
            <input type="text" value={note} placeholder="vd: narrative AI, hay pump cuối tuần" onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="bg-setup-note">
            {parsed.length === 0
              ? 'Không cần gõ đuôi USDT. Chỉ nhận coin có futures USDT-M trên Binance.'
              : `${parsed.length} mã · ${fresh.length} mới${parsed.length > fresh.length ? ` · ${parsed.length - fresh.length} đã có (cập nhật ghi chú nếu có)` : ''}`}
          </p>
          {error && <div className="bg-alert bg-alert--error">{error}</div>}
        </div>
        <div className="bg-setup-foot">
          <button type="button" className="bg-setup-cancel" onClick={onClose}>
            Huỷ
          </button>
          <button type="button" className="bg-setup-save" disabled={parsed.length === 0 || busy} onClick={() => void submit()}>
            {busy ? 'Đang thêm…' : `Thêm${fresh.length ? ` ${fresh.length} coin` : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
