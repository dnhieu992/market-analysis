import type { TradingStrategy } from '@web/shared/api/types';

type StrategiesTableProps = Readonly<{
  strategies: TradingStrategy[];
  onAddStrategy: () => void;
  onEditStrategy: (strategy: TradingStrategy) => void;
  onRemoveStrategy: (id: string) => void;
}>;

export function StrategiesTable({ strategies, onAddStrategy, onEditStrategy, onRemoveStrategy }: StrategiesTableProps) {
  return (
    <div className="table-shell">
      <div className="table-header">
        <h2 className="table-title">Strategies</h2>
        <button className="btn btn--primary" onClick={onAddStrategy}>+ Add Strategy</button>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Content</th>
              <th>Images</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {strategies.length === 0 ? (
              <tr>
                <td colSpan={6} className="table-empty">No strategies yet. Add one to get started.</td>
              </tr>
            ) : (
              strategies.map((strategy) => (
                <tr key={strategy.id}>
                  <td>
                    <button className="link-btn" onClick={() => onEditStrategy(strategy)}>
                      {strategy.name}
                    </button>
                  </td>
                  <td>
                    <span className="badge">{strategy.version}</span>
                  </td>
                  <td className="table-cell--truncate" title={strategy.content}>
                    {strategy.content.length > 80 ? `${strategy.content.slice(0, 80)}…` : strategy.content}
                  </td>
                  <td>{strategy.imageReference.length}</td>
                  <td>{new Date(strategy.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn--icon btn--danger" onClick={() => onRemoveStrategy(strategy.id)} title="Delete">
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
