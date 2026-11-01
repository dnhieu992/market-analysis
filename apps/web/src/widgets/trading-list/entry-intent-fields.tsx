'use client';

import { useEffect, useState } from 'react';

import type { EntryIntentInput, TradeEntryCheck, TradeStrategyInfo } from '@web/shared/api/client';

import styles from './trading-list.module.css';

/** Grades offered per strategy key (empty = no grade picker). */
const GRADES: Record<string, string[]> = {
  'qqe-pullback-swing': ['A', 'B'],
  'qqe-rsi1h-scalp': ['strong', 'normal'],
  'hedge-short': ['hedge'],
};
const DISCRETIONARY = 'discretionary';

export type EntryIntentDraft = { strategyKey: string; grade: string; reason: string; tags: string };

export const EMPTY_ENTRY_INTENT: EntryIntentDraft = { strategyKey: DISCRETIONARY, grade: '', reason: '', tags: '' };

/** Draft → the optional body fields of an order request. */
export function entryIntentOf(draft: EntryIntentDraft, strategies: TradeStrategyInfo[]): EntryIntentInput {
  const s = strategies.find((x) => x.key === draft.strategyKey);
  const tags = draft.tags
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 10);
  return {
    strategyKey: draft.strategyKey || undefined,
    grade: draft.grade || undefined,
    mode: s?.mode,
    reason: draft.reason.trim() || undefined,
    tags: tags.length ? tags : undefined,
  };
}

let strategyCache: TradeStrategyInfo[] | null = null;

type Props = {
  exchange: 'bitget' | 'mexc';
  symbol: string;
  holdSide: 'long' | 'short';
  value: EntryIntentDraft;
  onChange: (next: EntryIntentDraft) => void;
  /** Hands the loaded strategy list up so the parent can build the request body. */
  onStrategies?: (list: TradeStrategyInfo[]) => void;
  loadStrategies: () => Promise<TradeStrategyInfo[]>;
  checkEntry: (input: { symbol: string; side: 'long' | 'short'; exchange: 'bitget' | 'mexc' }) => Promise<TradeEntryCheck>;
};

const fmt = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));

/**
 * "Lý do vào lệnh" block of the /trading-list order dialogs: which entry strategy
 * this order follows (default "Cảm tính"), grade, free-text reason and tags,
 * plus a live hint of the strategies the coin matches right now. Saved on the
 * trade (trade_entries) and summarised in its journal.
 */
export function EntryIntentFields({ exchange, symbol, holdSide, value, onChange, onStrategies, loadStrategies, checkEntry }: Props) {
  const [strategies, setStrategies] = useState<TradeStrategyInfo[]>(strategyCache ?? []);
  const [check, setCheck] = useState<TradeEntryCheck | null>(null);
  const [checkState, setCheckState] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    if (strategyCache) onStrategies?.(strategyCache);
    else
      loadStrategies()
        .then((list) => {
          strategyCache = list;
          if (!alive) return;
          setStrategies(list);
          onStrategies?.(list);
        })
        .catch(() => undefined);
    setCheckState('loading');
    checkEntry({ symbol, side: holdSide, exchange })
      .then((r) => {
        if (!alive) return;
        setCheck(r);
        setCheckState('done');
      })
      .catch(() => alive && setCheckState('error'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchange, symbol, holdSide]);

  const grades = GRADES[value.strategyKey] ?? [];
  const best = check?.matched[0] ?? null;
  const bestName = best ? strategies.find((s) => s.key === best.key)?.name ?? best.key : null;
  const f = check?.features ?? null;

  return (
    <section className={styles.intentBox}>
      <div className={styles.intentHead}>🧭 Lý do vào lệnh</div>
      <div className={styles.intentHint}>
        {checkState === 'loading' && 'Đang kiểm tra bối cảnh…'}
        {checkState === 'error' && 'Không kiểm tra được bối cảnh (vẫn đặt lệnh được).'}
        {checkState === 'done' && (
          <>
            {best ? (
              <>
                Đang khớp: <strong>{bestName}</strong> — {best.grade}{' '}
                {(value.strategyKey !== best.key || value.grade !== best.grade) && (
                  <button
                    type="button"
                    className={styles.intentUse}
                    onClick={() => onChange({ ...value, strategyKey: best.key, grade: best.grade })}
                  >
                    Dùng
                  </button>
                )}
              </>
            ) : (
              <>Không khớp chiến lược nào có quy tắc.</>
            )}
            {f && (
              <div className={styles.intentFeat}>
                QQE D1 {f.qqeD1 ?? '—'} · H4 {f.qqeH4 ?? '—'} · RSI H4 {fmt(f.rsiH4)} · 1h {fmt(f.rsi1h)} · EMA89 D1{' '}
                {f.distEma89D1Pct != null ? `${f.distEma89D1Pct >= 0 ? '+' : ''}${fmt(f.distEma89D1Pct)}%` : '—'}
              </div>
            )}
          </>
        )}
      </div>
      <div className="bg-bulk-row">
        <label className="bg-setup-field">
          <span>Chiến lược</span>
          <select
            value={value.strategyKey}
            onChange={(e) => onChange({ ...value, strategyKey: e.target.value, grade: (GRADES[e.target.value] ?? [])[0] ?? '' })}
          >
            {(strategies.length ? strategies : [{ key: DISCRETIONARY, name: 'Cảm tính / ngoài quy tắc' } as TradeStrategyInfo]).map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {grades.length > 0 && (
          <label className="bg-setup-field">
            <span>Hạng</span>
            <select value={value.grade} onChange={(e) => onChange({ ...value, grade: e.target.value })}>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="bg-setup-field">
        <span>Lý do (tuỳ chọn)</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={value.reason}
          placeholder="vd: hồi về hỗ trợ H4, RSI H4 38"
          onChange={(e) => onChange({ ...value, reason: e.target.value })}
        />
      </label>
      <label className="bg-setup-field">
        <span>Tag (cách nhau bằng dấu phẩy)</span>
        <input value={value.tags} placeholder="vd: fomo, tin-tuc" onChange={(e) => onChange({ ...value, tags: e.target.value })} />
      </label>
    </section>
  );
}
