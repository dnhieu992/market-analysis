'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';
import type {
  DeepseekMarketAnalysis,
  DeepseekMarketTicker,
  DeepseekStatus,
} from '@web/shared/api/types';

const api = createApiClient();

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `$${n.toPrecision(4)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/** Green above zero, red below — `—` stays neutral. */
function pctClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'ds-pos' : 'ds-neg';
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TickerTable({ title, rows }: { title: string; rows: DeepseekMarketTicker[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="ds-table-block">
      <h4>{title}</h4>
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead>
            <tr>
              <th>Coin</th>
              <th className="ds-num">Giá</th>
              <th className="ds-num">24h</th>
              <th className="ds-num">Khối lượng 24h</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.symbol}>
                <td>{t.coin}</td>
                <td className="ds-num">{fmtUsd(t.price)}</td>
                <td className={`ds-num ${pctClass(t.change24hPct)}`}>{fmtPct(t.change24hPct)}</td>
                <td className="ds-num">{fmtUsd(t.volumeUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The "Thị trường hôm nay" agent card.
 *
 * The button does two things in one round trip: the API snapshots Binance's 24h
 * data and then has DeepSeek write about it. Both come back, and both are shown —
 * the prose on top, the numbers it was given underneath — because the agent is
 * instructed to use only that snapshot, so the table is how the trader audits it.
 */
export function MarketTodayAgent({ status }: { status: DeepseekStatus }) {
  const [result, setResult] = useState<DeepseekMarketAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.runDeepseekMarketToday());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const snapshot = result?.snapshot;

  return (
    <section className="ds-agent">
      <header className="ds-agent-head">
        <div>
          <h2>Thị trường hôm nay</h2>
          <p>
            Chụp số liệu 24h của toàn bộ cặp USDT trên Binance spot (coin vốn hoá lớn, độ rộng thị
            trường, top tăng/giảm), rồi để DeepSeek viết bản tin tiếng Việt dựa trên đúng những số
            liệu đó.
          </p>
        </div>
        <span className="ds-model-badge" title="Model DeepSeek đang dùng (đổi bằng biến môi trường DEEPSEEK_MODEL)">
          {status.model}
        </span>
      </header>

      <div className="ds-agent-actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={analyze}
          disabled={loading || !status.configured}
        >
          {loading ? 'Đang phân tích…' : 'Analyze'}
        </button>
        {!status.configured ? (
          <span className="ds-hint ds-hint--warn">
            Chưa cấu hình <code>DEEPSEEK_API_KEY</code> — thêm key vào <code>.env</code> rồi khởi
            động lại API.
          </span>
        ) : loading ? (
          <span className="ds-hint">Lấy dữ liệu Binance rồi gọi DeepSeek — có thể mất 10–60 giây.</span>
        ) : null}
      </div>

      {error ? <p className="ds-error">{error}</p> : null}

      {result && snapshot ? (
        <div className="ds-result">
          <div
            className="ds-analysis"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(result.analysis) }}
          />

          {result.reasoning ? (
            <details className="ds-reasoning">
              <summary>Quá trình suy luận của model</summary>
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(result.reasoning) }} />
            </details>
          ) : null}

          <details className="ds-snapshot" open>
            <summary>Dữ liệu đã đưa cho model ({snapshot.breadth.pairs} cặp USDT)</summary>

            <div className="ds-stat-row">
              <div className="ds-stat">
                <span>Cặp tăng giá</span>
                <strong className={pctClass(snapshot.breadth.advancingPct - 50)}>
                  {fmtPct(snapshot.breadth.advancingPct)}
                </strong>
                <small>
                  {snapshot.breadth.advancing} tăng / {snapshot.breadth.declining} giảm
                </small>
              </div>
              <div className="ds-stat">
                <span>Khối lượng 24h</span>
                <strong>{fmtUsd(snapshot.breadth.totalVolumeUsd)}</strong>
                <small>toàn bộ cặp USDT</small>
              </div>
              {snapshot.anchors.map((a) => (
                <div className="ds-stat" key={a.coin}>
                  <span>{a.coin}</span>
                  <strong className={pctClass(a.change24hPct)}>{fmtPct(a.change24hPct)}</strong>
                  <small>
                    7d {fmtPct(a.change7dPct)} · 30d {fmtPct(a.change30dPct)}
                  </small>
                </div>
              ))}
            </div>

            <TickerTable title="Coin vốn hoá lớn" rows={snapshot.majors} />
            <TickerTable title="Tăng mạnh nhất 24h" rows={snapshot.topGainers} />
            <TickerTable title="Giảm mạnh nhất 24h" rows={snapshot.topLosers} />
          </details>

          <p className="ds-meta">
            {result.model} · dữ liệu lúc {fmtTime(snapshot.capturedAt)} · trả lời lúc{' '}
            {fmtTime(result.generatedAt)}
            {result.usage ? ` · ${result.usage.totalTokens.toLocaleString('en-US')} tokens` : ''}
          </p>
        </div>
      ) : null}
    </section>
  );
}
