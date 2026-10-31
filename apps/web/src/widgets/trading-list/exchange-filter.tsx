'use client';

import { EXCHANGES, EXCHANGE_LABEL, EXCHANGE_SHORT, type ExchangeFilter } from './exchanges';

import styles from './trading-list.module.css';

/** Tất cả / [BG] Bitget / [MX] MEXC switch shown at the head of each /trading-list tab. */
export function ExchangeFilterBar({ value, onChange }: { value: ExchangeFilter; onChange: (next: ExchangeFilter) => void }) {
  return (
    <div className={styles.exFilter} role="radiogroup" aria-label="Lọc theo sàn">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'all'}
        className={`${styles.exFilterBtn} ${value === 'all' ? styles.exFilterBtnActive : ''}`}
        onClick={() => onChange('all')}
      >
        Tất cả
      </button>
      {EXCHANGES.map((ex) => (
        <button
          key={ex}
          type="button"
          role="radio"
          aria-checked={value === ex}
          className={`${styles.exFilterBtn} ${value === ex ? styles.exFilterBtnActive : ''}`}
          onClick={() => onChange(ex)}
        >
          <span className={`${styles.exTag} ${styles[`ex_${ex}`]}`}>{EXCHANGE_SHORT[ex]}</span>
          {EXCHANGE_LABEL[ex]}
        </button>
      ))}
    </div>
  );
}
