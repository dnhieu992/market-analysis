'use client';

import { useEffect, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { SpotStrategy } from '@web/shared/api/types';

import styles from './tracking.module.css';

const STATUS_LABEL: Record<SpotStrategy['status'], string> = { active: 'Đang áp dụng', draft: 'Nháp', retired: 'Ngừng dùng' };

/**
 * Reference for the Spot Analytic strategies: rules, target, backtest numbers and lessons. The
 * active strategy is the one the page's chat follows. Strategies live in code
 * (packages/skills tracking-swing/strategies.ts), so this view is read-only.
 */
export function SpotStrategiesDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ active: string; strategies: SpotStrategy[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    createApiClient()
      .fetchSpotStrategies()
      .then((d) => { setData(d); setSelected(d.active); })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = data?.strategies.find((x) => x.id === selected) ?? null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Chiến lược Spot Analytic</span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dialog-body">
          {error && <p className={styles.error}>{error}</p>}
          {!data && !error && <p className={styles.hint}>Đang tải…</p>}
          {data && (
            <>
              <div className={styles.stratTabs} role="tablist">
                {data.strategies.map((x) => (
                  <button
                    key={x.id}
                    role="tab"
                    aria-selected={x.id === selected}
                    className={`${styles.stratTab} ${x.id === selected ? styles.stratTabActive : ''}`}
                    onClick={() => setSelected(x.id)}
                  >
                    Chiến lược {x.id}
                    {x.status === 'active' && <span className={styles.stratBadge}>chat đang dùng</span>}
                  </button>
                ))}
              </div>
              {s && (
                <div className={styles.strat}>
                  <h3 className={styles.stratName}>{s.name}</h3>
                  <p className={styles.hint}>{STATUS_LABEL[s.status]} · tạo {s.createdAt}</p>
                  <p>{s.summary}</p>
                  <p className={styles.stratTarget}><strong>Mục tiêu:</strong> {s.target}</p>

                  <h4 className={styles.historyTitle}>Quy tắc</h4>
                  {s.rules.map((g) => (
                    <div key={g.title} className={styles.stratGroup}>
                      <div className={styles.stratGroupTitle}>{g.title}</div>
                      <ul className={styles.stratList}>{g.items.map((i) => <li key={i}>{i}</li>)}</ul>
                    </div>
                  ))}

                  <h4 className={styles.historyTitle}>Backtest</h4>
                  <p className={styles.hint}>{s.backtest.period} · {s.backtest.universe}. {s.backtest.method}.</p>
                  <div className={styles.historyTableWrap}>
                    <table className={styles.historyTable}>
                      <thead><tr><th>Cấu hình</th><th>{s.backtest.columns?.[0] ?? 'Lãi/năm'}</th><th>{s.backtest.columns?.[1] ?? 'Sụt giảm tối đa'}</th></tr></thead>
                      <tbody>
                        {s.backtest.rows.map((r) => (
                          <tr key={r.config}>
                            <td className={styles.stratWrap}>{r.config}{r.note && <div className={styles.hint}>{r.note}</div>}</td>
                            <td>{r.cagr}</td>
                            <td>{r.maxDd}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className={styles.stratList}>{s.backtest.takeaways.map((i) => <li key={i}>{i}</li>)}</ul>

                  <h4 className={styles.historyTitle}>Rút ra từ thị trường</h4>
                  <ul className={styles.stratList}>{s.lessons.map((i) => <li key={i}>{i}</li>)}</ul>

                  <h4 className={styles.historyTitle}>Giới hạn</h4>
                  <ul className={styles.stratList}>{s.limits.map((i) => <li key={i}>{i}</li>)}</ul>

                  <p className={styles.hint}>Nguồn: {s.sources.join(' · ')}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
