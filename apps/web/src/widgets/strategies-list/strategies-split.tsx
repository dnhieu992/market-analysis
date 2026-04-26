'use client';

import { useRouter } from 'next/navigation';

import type { TradingStrategy } from '@web/shared/api/types';

import { StrategyDetailPanel } from './strategy-detail-panel';

type StrategiesSplitProps = Readonly<{
  strategies: TradingStrategy[];
  selectedId: string | null;
  onCreateClick: () => void;
}>;

export function StrategiesSplit({ strategies, selectedId, onCreateClick }: StrategiesSplitProps) {
  const router = useRouter();
  const selected = strategies.find((s) => s.id === selectedId) ?? null;

  function selectStrategy(id: string) {
    router.push(`/strategy?id=${id}`);
  }

  return (
    <div className="strat-page">
      <div className="strat-page-header">
        <h1 className="strat-page-title">Strategies</h1>
        <button className="btn btn--primary" onClick={onCreateClick}>+ Add Strategy</button>
      </div>

      <div className="strat-split">
        {/* Left: list */}
        <div className="strat-list">
          {strategies.length === 0 ? (
            <div className="strat-empty">No strategies yet.</div>
          ) : (
            strategies.map((strategy) => (
              <button
                key={strategy.id}
                className={`strat-list-item${strategy.id === selectedId ? ' strat-list-item--active' : ''}`}
                onClick={() => selectStrategy(strategy.id)}
              >
                <span className="strat-list-item-name">{strategy.name}</span>
                <span className="strat-list-item-meta">v{strategy.version}</span>
              </button>
            ))
          )}
        </div>

        {/* Right: detail panel */}
        {selected ? (
          <StrategyDetailPanel key={selected.id} strategy={selected} />
        ) : (
          <div className="strat-detail-placeholder">
            Select a strategy to view details
          </div>
        )}
      </div>
    </div>
  );
}
