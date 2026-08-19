'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';
import type {
  DeepseekBtcDaytrade,
  DeepseekBtcDaytradeHistoryItem,
  DeepseekDaytradeSignal,
  DeepseekStatus,
  DeepseekTimeframeReport,
  DeepseekTrendLine,
} from '@web/shared/api/types';

const api = createApiClient();

function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: digits })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
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

/** `YYYY-MM-DD` → `DD/MM`. The key is already the Vietnam day, so no timezone maths. */
function fmtDayShort(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`. */
function fmtDay(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

const DIRECTION_LABEL: Record<DeepseekDaytradeSignal['direction'], string> = {
  LONG: 'LONG',
  SHORT: 'SHORT',
  NO_TRADE: 'ĐỨNG NGOÀI',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'độ tin cậy cao',
  medium: 'độ tin cậy trung bình',
  low: 'độ tin cậy thấp',
};

const STRUCTURE_LABEL: Record<DeepseekTimeframeReport['structure'], string> = {
  uptrend: 'Tăng',
  downtrend: 'Giảm',
  range: 'Đi ngang',
};

const BIAS_LABEL: Record<string, string> = {
  bullish: 'tăng',
  bearish: 'giảm',
  neutral: 'trung lập',
};

const structureClass = (structure: DeepseekTimeframeReport['structure']): string =>
  structure === 'uptrend' ? 'ds-pos' : structure === 'downtrend' ? 'ds-neg' : '';

/** The trend line that still holds, preferring the one price is closest to. */
function activeTrendLine(tf: DeepseekTimeframeReport): DeepseekTrendLine | null {
  const alive = tf.trendLines.filter((l) => !l.broken);
  const pool = alive.length > 0 ? alive : tf.trendLines;
  return (
    [...pool].sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))[0] ?? null
  );
}

/** The three retracement levels a day trader actually enters on. */
const KEY_FIB_RATIOS = [0.382, 0.5, 0.618];

const biasClass = (bias: string | undefined): string =>
  bias === 'bullish' ? 'ds-bias--up' : bias === 'bearish' ? 'ds-bias--down' : 'ds-bias--flat';

/** Entry zone as one string — collapses to a single price when from === to. */
function entryText(signal: DeepseekDaytradeSignal): string {
  const { entryFrom, entryTo } = signal;
  if (entryFrom == null) return '—';
  if (entryTo == null || entryTo === entryFrom) return fmtUsd(entryFrom);
  const [low, high] = entryFrom <= entryTo ? [entryFrom, entryTo] : [entryTo, entryFrom];
  return `${fmtUsd(low)} – ${fmtUsd(high)}`;
}

/**
 * The setup card: direction, the four prices that define the trade, and the R/R
 * the API recomputed from those prices. `riskRewardModel` is shown next to it
 * only when the two disagree — that gap is itself information about the answer.
 */
function SignalCard({ signal }: { signal: DeepseekDaytradeSignal }) {
  const trade = signal.direction !== 'NO_TRADE';
  const modifier =
    signal.direction === 'LONG' ? 'ds-signal--long' : signal.direction === 'SHORT' ? 'ds-signal--short' : 'ds-signal--none';

  return (
    <div className={`ds-signal ${modifier}`}>
      <div className="ds-signal-head">
        <span className="ds-signal-dir">{DIRECTION_LABEL[signal.direction]}</span>
        {signal.confidence ? (
          <span className="ds-signal-conf">{CONFIDENCE_LABEL[signal.confidence]}</span>
        ) : null}
        {signal.summary ? <p className="ds-signal-summary">{signal.summary}</p> : null}
      </div>

      {trade ? (
        <div className="ds-signal-grid">
          <div className="ds-signal-cell">
            <span>Vùng vào lệnh</span>
            <strong>{entryText(signal)}</strong>
          </div>
          <div className="ds-signal-cell">
            <span>Stop loss</span>
            <strong className="ds-neg">{fmtUsd(signal.stopLoss)}</strong>
            <small>{signal.riskPct != null ? `rủi ro ${fmtNum(signal.riskPct)}%` : ''}</small>
          </div>
          <div className="ds-signal-cell">
            <span>Take profit</span>
            <strong className="ds-pos">
              {signal.takeProfits.length > 0 ? signal.takeProfits.map((tp) => fmtUsd(tp)).join(' · ') : '—'}
            </strong>
          </div>
          <div className="ds-signal-cell">
            <span>R/R tới TP1</span>
            <strong>{fmtNum(signal.riskReward)}</strong>
            <small>
              {signal.riskRewardModel != null && signal.riskReward != null &&
              Math.abs(signal.riskRewardModel - signal.riskReward) > 0.05
                ? `model khai ${fmtNum(signal.riskRewardModel)}`
                : 'tính lại từ giá của model'}
            </small>
          </div>
        </div>
      ) : null}

      {Object.keys(signal.timeframeBias).length > 0 ? (
        <div className="ds-bias-row">
          {Object.entries(signal.timeframeBias).map(([tf, bias]) => (
            <span key={tf} className={`ds-bias ${biasClass(bias)}`}>
              {tf.toUpperCase()} · {BIAS_LABEL[bias ?? ''] ?? bias}
            </span>
          ))}
        </div>
      ) : null}

      {signal.invalidation ? (
        <p className="ds-signal-invalidation">
          <strong>Huỷ setup khi:</strong> {signal.invalidation}
        </p>
      ) : null}

      {signal.warnings.length > 0 ? (
        <ul className="ds-warnings">
          {signal.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One row per timeframe — the price action the model was handed, top-down.
 *
 * No indicator columns by design: the structure column is the trend read (from
 * the pivot labels shown next to it), and the trend line / fib columns are the
 * only other things the agent is allowed to reason from.
 */
function TimeframeTable({ rows }: { rows: DeepseekTimeframeReport[] }) {
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th>Khung</th>
            <th>Cấu trúc</th>
            <th className="ds-num">Đóng cửa</th>
            <th className="ds-num">Swing cao / thấp</th>
            <th className="ds-num">Hỗ trợ</th>
            <th className="ds-num">Kháng cự</th>
            <th className="ds-num">Trend line</th>
            <th className="ds-num">Chân sóng fib</th>
            <th className="ds-num">Fib 0.382 / 0.5 / 0.618</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tf) => {
            const line = activeTrendLine(tf);
            const keyFibs = (tf.fib?.retracements ?? []).filter((l) =>
              KEY_FIB_RATIOS.includes(l.ratio),
            );
            return (
              <tr key={tf.timeframe}>
                <td title={tf.role}>
                  <strong>{tf.label}</strong>
                </td>
                <td className={structureClass(tf.structure)}>
                  {STRUCTURE_LABEL[tf.structure]} <small>({tf.structureNote})</small>
                </td>
                <td className={`ds-num ${pctClass(tf.changePct)}`}>
                  {fmtUsd(tf.close)} <small>({fmtPct(tf.changePct)})</small>
                </td>
                <td className="ds-num">
                  {fmtUsd(tf.swingHigh, 0)} / {fmtUsd(tf.swingLow, 0)}{' '}
                  <small>({fmtNum(tf.swingRangePct)}%)</small>
                </td>
                <td className="ds-num">
                  {tf.supports.length > 0 ? tf.supports.map((s) => fmtUsd(s, 0)).join(', ') : '—'}
                </td>
                <td className="ds-num">
                  {tf.resistances.length > 0 ? tf.resistances.map((r) => fmtUsd(r, 0)).join(', ') : '—'}
                </td>
                <td className="ds-num">
                  {line ? (
                    <>
                      {fmtUsd(line.priceNow, 0)}{' '}
                      <small className={line.broken ? 'ds-neg' : ''}>
                        {line.kind === 'support' ? 'đáy' : 'đỉnh'} ·{' '}
                        {line.broken ? 'đã gãy' : `${line.touches} chạm`} · {fmtPct(line.distancePct)}
                      </small>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="ds-num">
                  {tf.fib ? (
                    <>
                      {fmtUsd(tf.fib.from.price, 0)} → {fmtUsd(tf.fib.to.price, 0)}{' '}
                      <small>hồi {fmtNum(tf.fib.retracedPct, 0)}%</small>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="ds-num">
                  {keyFibs.length > 0 ? keyFibs.map((l) => fmtUsd(l.price, 0)).join(' / ') : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The BTC day-trading agent card.
 *
 * The button does two things in one round trip: the API snapshots BTCUSDT across
 * 1D / 4H / 1H / 15m and then has DeepSeek read them top-down into one intraday
 * setup. Setup, explanation and source data all come back, and all three are
 * shown — the agent may only use the snapshot, so the table is how it is audited.
 */
export function BtcDaytradeAgent({
  status,
  initial,
  history,
}: {
  status: DeepseekStatus;
  /** Today's stored analysis, loaded server-side — null before the first run of the day. */
  initial: DeepseekBtcDaytrade | null;
  history: DeepseekBtcDaytradeHistoryItem[];
}) {
  const [result, setResult] = useState<DeepseekBtcDaytrade | null>(initial);
  const [days, setDays] = useState<DeepseekBtcDaytradeHistoryItem[]>(history);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDay, setLoadingDay] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const fresh = await api.runDeepseekBtcDaytrade();
      setResult(fresh);
      // The run just overwrote (or created) today's row, so pull the strip again
      // rather than patching it by hand and risking a stale direction or R/R.
      setDays(await api.fetchDeepseekBtcDaytradeHistory().catch(() => days));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function openDay(date: string) {
    if (date === result?.date) return;
    setLoadingDay(date);
    setError(null);
    try {
      const stored = await api.fetchDeepseekBtcDaytradeByDate(date);
      if (stored) setResult(stored);
      else setError(`Không tìm thấy bản ghi ngày ${fmtDay(date)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDay(null);
    }
  }

  const snapshot = result?.snapshot;

  return (
    <section className="ds-agent">
      <header className="ds-agent-head">
        <div>
          <h2>BTC day trading — price action đa khung</h2>
          <p>
            Chụp dữ liệu BTCUSDT trên 4 khung 1D / 4H / 1H / 15m và chỉ dùng{' '}
            <strong>price action, trend line và Fibonacci</strong> — cấu trúc HH/HL, swing, hỗ trợ –
            kháng cự, nến thô kèm volume. Không có EMA / RSI / MACD / ATR, và model bị cấm nhắc tới
            chỉ báo vì dữ liệu không có. Giá vào / SL / TP do model đưa ra được API kiểm tra lại
            bằng công thức, kèm chart 4H + 15m vẽ sẵn, rồi lưu thành bản ghi của ngày hôm đó.
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
          {loading ? 'Đang phân tích…' : initial ? 'Phân tích lại hôm nay' : 'Phân tích BTC'}
        </button>
        {initial && !loading && status.configured ? (
          <span className="ds-hint">Chạy lại sẽ ghi đè bản ghi của hôm nay.</span>
        ) : null}
        {!status.configured ? (
          <span className="ds-hint ds-hint--warn">
            Chưa cấu hình <code>DEEPSEEK_API_KEY</code> — thêm key vào <code>.env</code> rồi khởi
            động lại API.
          </span>
        ) : loading ? (
          <span className="ds-hint">
            Lấy 4 khung dữ liệu Binance, gọi DeepSeek rồi vẽ chart — có thể mất 10–60 giây.
          </span>
        ) : null}
      </div>

      {days.length > 0 ? (
        <div className="ds-history">
          <span className="ds-history-label">Nhật ký theo ngày</span>
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              className={`ds-history-item ${day.date === result?.date ? 'is-active' : ''} ${
                day.direction === 'LONG' ? 'ds-history-item--long' : day.direction === 'SHORT' ? 'ds-history-item--short' : ''
              }`}
              onClick={() => openDay(day.date)}
              disabled={loadingDay !== null}
              title={day.summary ?? undefined}
            >
              <strong>{fmtDayShort(day.date)}</strong>
              <small>
                {DIRECTION_LABEL[day.direction]}
                {day.riskReward != null ? ` · R/R ${fmtNum(day.riskReward)}` : ''}
              </small>
            </button>
          ))}
          {loadingDay ? <span className="ds-hint">Đang mở {fmtDay(loadingDay)}…</span> : null}
        </div>
      ) : null}

      {error ? <p className="ds-error">{error}</p> : null}

      {result && snapshot ? (
        <div className="ds-result">
          <p className="ds-record-meta">
            Bản ghi ngày <strong>{fmtDay(result.date)}</strong>
            {result.runCount > 1 ? ` · đã chạy lại ${result.runCount} lần trong ngày` : ''}
          </p>

          {result.signal ? (
            <SignalCard signal={result.signal} />
          ) : (
            <p className="ds-hint ds-hint--warn">
              Model không trả về khối tín hiệu đúng định dạng — chỉ có phần phân tích bên dưới.
            </p>
          )}

          {result.chartUrl ? (
            <figure className="ds-chart">
              {/* Plain <img>: the PNG lives on R2, outside Next's image domains, and
                  it is a static export that gains nothing from optimisation. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.chartUrl} alt={`Chart BTC 4H + 15m ngày ${fmtDay(result.date)}`} />
              <figcaption>
                4H (bối cảnh) + 15m (điểm vào) — pivot HH/HL, trend line, fib và vùng vào / SL / TP.
              </figcaption>
            </figure>
          ) : null}

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
            <summary>Dữ liệu đã đưa cho model ({snapshot.symbol}, 4 khung thời gian)</summary>

            <div className="ds-stat-row">
              <div className="ds-stat">
                <span>Giá hiện tại</span>
                <strong>{fmtUsd(snapshot.price)}</strong>
                <small>nến 15m đang chạy</small>
              </div>
              <div className="ds-stat">
                <span>Biến động 24h</span>
                <strong className={pctClass(snapshot.change24hPct)}>{fmtPct(snapshot.change24hPct)}</strong>
                <small>
                  H {fmtUsd(snapshot.high24h, 0)} · L {fmtUsd(snapshot.low24h, 0)}
                </small>
              </div>
              {snapshot.timeframes.map((tf) => (
                <div className="ds-stat" key={tf.timeframe}>
                  <span>{tf.label}</span>
                  <strong className={structureClass(tf.structure)}>
                    {STRUCTURE_LABEL[tf.structure]}
                  </strong>
                  <small>
                    {tf.structureNote}
                    {tf.fib ? ` · hồi ${fmtNum(tf.fib.retracedPct, 0)}%` : ''}
                  </small>
                </div>
              ))}
            </div>

            <div className="ds-table-block">
              <h4>Price action theo khung (tính trên nến đã đóng)</h4>
              <TimeframeTable rows={snapshot.timeframes} />
            </div>
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
