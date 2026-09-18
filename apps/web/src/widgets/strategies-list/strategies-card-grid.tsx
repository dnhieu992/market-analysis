'use client';

import Link from 'next/link';

import type { TradingStrategy } from '@web/shared/api/types';

type StrategiesCardGridProps = Readonly<{
  strategies: TradingStrategy[];
  onCreateClick: () => void;
}>;

/** Plain-text snippet for the mobile preview card — strips markdown so a table/heading
 *  blob doesn't render as raw `#`/`|` noise. */
function previewText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^[#>\-*|\s]+/gm, ' ')
    .replace(/[*_`#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function StrategiesCardGrid({ strategies, onCreateClick }: StrategiesCardGridProps) {
  return (
    <div className="strat-page">
      <div className="strat-page-header">
        <h1 className="strat-page-title">Strategy Analysis</h1>
        <button className="btn btn--primary" onClick={onCreateClick}>+ Add Strategy</button>
      </div>

      {strategies.length === 0 ? (
        <div className="strat-empty">No strategies yet. Add one to get started.</div>
      ) : (
        <div className="sgrid-grid">
          {strategies.map((strategy) => (
            <Link key={strategy.id} href={`/strategy/${strategy.id}`} className="sgrid-card">
              <div className="sgrid-card-top">
                <span className="sgrid-card-name">{strategy.name}</span>
                <span className="strat-ver-badge">{strategy.version}</span>
              </div>
              <p className="sgrid-card-preview">{previewText(strategy.content)}</p>
              <span className="sgrid-card-date">
                {new Date(strategy.createdAt).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
