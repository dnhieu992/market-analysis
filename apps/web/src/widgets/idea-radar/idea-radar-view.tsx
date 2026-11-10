'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  IdeaRadarCost,
  IdeaRadarIdea,
  IdeaRadarIdeaStatus,
  IdeaRadarOverview,
  IdeaRadarRun,
  IdeaRadarRunSummary,
} from '@web/shared/api/types';
import { renderMarkdown } from '@web/shared/lib/markdown';

import styles from './idea-radar.module.css';

const api = createApiClient();
const POLL_MS = 5_000;

type Tab = 'run' | 'shortlist' | 'all' | 'report' | 'config';

const TABS: Array<[Tab, string]> = [
  ['run', 'Kỳ này'],
  ['shortlist', 'Shortlist'],
  ['all', 'Tất cả ý tưởng'],
  ['report', 'Báo cáo'],
  ['config', 'Cấu hình'],
];

const STEP_LABEL: Record<string, string> = {
  collect: 'Đang thu thập dữ liệu',
  trends: 'Đang phân tích xu hướng',
  reviews: 'Đang lấy review 1–2★',
  pain_points: 'Claude đang đọc review',
  ideas: 'Claude đang sinh ý tưởng',
  report: 'Đang viết báo cáo',
  notify: 'Đang gửi Telegram',
};

const STATUS_LABEL: Record<IdeaRadarRunSummary['status'], string> = {
  RUNNING: 'Đang chạy',
  SUCCESS: 'Thành công',
  PARTIAL: 'Có lỗi một phần',
  FAILED: 'Thất bại',
};

const MONETIZATION_LABEL: Record<string, string> = {
  ads: 'Quảng cáo',
  subscription: 'Thuê bao',
  iap: 'Mua trong app',
  paid: 'Trả phí 1 lần',
  hybrid: 'Kết hợp',
};

const EVIDENCE_ICON: Record<string, string> = { pain_point: '😣', trend_signal: '📈', post: '💬' };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** renderMarkdown has no links — turn [label](https://…) into anchors after it escaped the HTML. */
const withLinks = (html: string) =>
  html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"<]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.scoreBar} title={`${label}: ${fmt(value)}/5`}>
      <span>{label}</span>
      <span className={styles.scoreTrack}>
        <span className={styles.scoreFill} style={{ width: `${(value / 5) * 100}%` }} />
      </span>
      <span className={styles.scoreNum}>{fmt(value)}</span>
    </div>
  );
}

function IdeaCard({
  idea,
  rank,
  onMark,
  showRunDate,
}: {
  idea: IdeaRadarIdea;
  rank?: number;
  onMark: (idea: IdeaRadarIdea, status: IdeaRadarIdeaStatus) => void;
  showRunDate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shortlisted = idea.status === 'shortlisted';
  const dismissed = idea.status === 'dismissed';

  return (
    <li className={`${styles.card} ${shortlisted ? styles.cardShortlisted : ''} ${dismissed ? styles.cardDismissed : ''}`}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitleWrap}>
          <h3 className={styles.cardTitle}>
            {rank !== undefined ? <span className={styles.rank}>{rank}.</span> : null}
            {idea.title}
            {idea.repeatOf ? (
              <span className={styles.repeat} title={`Lặp lại từ kỳ trước: ${idea.repeatOf}`}>
                🔁 lặp lại
              </span>
            ) : null}
          </h3>
          <p className={styles.oneLiner}>{idea.oneLiner}</p>
          {showRunDate && idea.run ? <p className={styles.meta}>Kỳ {idea.run.runDate}{idea.run.dryRun ? ' · dry-run' : ''}</p> : null}
        </div>
        <div className={styles.total} title="Điểm tổng (trọng số)">
          {fmt(idea.scoreTotal)}
        </div>
      </div>

      <div className={styles.scores}>
        <ScoreBar label="Nhu cầu" value={idea.scoreDemand} />
        <ScoreBar label="Cạnh tranh" value={idea.scoreCompetition} />
        <ScoreBar label="Kiếm tiền" value={idea.scoreMonetization} />
        <ScoreBar label="Công sức" value={idea.scoreEffort} />
      </div>

      <div className={styles.tags}>
        <span className={styles.tag}>{MONETIZATION_LABEL[idea.monetization.model] ?? idea.monetization.model}</span>
        <span className={styles.tag}>{idea.evidence.length} bằng chứng</span>
        <span className={styles.tag}>{idea.targetUsers}</span>
      </div>

      {open ? (
        <div className={styles.details}>
          <p>
            <strong>Vấn đề:</strong> {idea.problem}
          </p>
          <p>
            <strong>Giải pháp:</strong> {idea.solution}
          </p>
          <p>
            <strong>Kiếm tiền:</strong> {idea.monetization.explanation}
          </p>
          {idea.repeatOf ? (
            <p>
              <strong>Lặp lại từ:</strong> {idea.repeatOf}
            </p>
          ) : null}
          <strong>Tính năng MVP</strong>
          <ul>
            {idea.keyFeatures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {idea.competitors.length ? (
            <>
              <strong>Đối thủ</strong>
              <ul>
                {idea.competitors.map((c) => (
                  <li key={c.name}>
                    {c.name} — <span className={styles.muted}>{c.weakness}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <strong>Bằng chứng</strong>
          <ul className={styles.evidence}>
            {idea.evidence.map((e) => (
              <li key={e.id}>
                <span aria-hidden="true">{EVIDENCE_ICON[e.type] ?? '•'}</span>{' '}
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {e.label}
                  </a>
                ) : (
                  e.label
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={styles.linkBtn} onClick={() => setOpen((v) => !v)}>
          {open ? 'Thu gọn' : 'Chi tiết'}
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          className={`${styles.btn} ${shortlisted ? styles.btnActive : ''}`}
          onClick={() => onMark(idea, shortlisted ? (idea.repeatOf ? 'repeat' : 'new') : 'shortlisted')}
        >
          {shortlisted ? '★ Đã shortlist' : '☆ Shortlist'}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${dismissed ? styles.btnActive : ''}`}
          onClick={() => onMark(idea, dismissed ? (idea.repeatOf ? 'repeat' : 'new') : 'dismissed')}
        >
          {dismissed ? 'Đã bỏ qua' : 'Bỏ qua'}
        </button>
      </div>
    </li>
  );
}

function RunSummary({ run }: { run: IdeaRadarRun }) {
  const s = run.stats ?? {};
  const errors = run.errors ?? [];
  return (
    <section className={styles.summary}>
      <div className={styles.summaryHead}>
        <strong>
          Kỳ {run.runDate}
          {run.dryRun ? ' · dry-run' : ''}
        </strong>
        <span className={`${styles.status} ${styles[`status${run.status}`] ?? ''}`}>{STATUS_LABEL[run.status]}</span>
        <span className={styles.muted}>
          {run.trigger === 'CRON' ? 'tự động' : 'chạy tay'}
          {s.durationSec ? ` · ${Math.round(s.durationSec / 60)} phút` : ''}
        </span>
      </div>
      {run.stats ? (
        <div className={styles.stats}>
          <span>
            <b>{s.appsTracked ?? 0}</b> app
          </span>
          <span>
            <b>{s.reviewsAnalyzed ?? 0}</b> review 1–2★
          </span>
          <span>
            <b>{s.postsAnalyzed ?? 0}</b> bài Reddit/HN
          </span>
          <span>
            <b>{s.signals ?? 0}</b> tín hiệu
          </span>
          <span>
            <b>{s.painPoints ?? 0}</b> pain point
          </span>
          {s.llmCostUsd ? (
            <span>
              Claude <b>${s.llmCostUsd.toFixed(2)}</b>
            </span>
          ) : null}
        </div>
      ) : null}
      {errors.length ? (
        <details className={styles.errors}>
          <summary>⚠️ {errors.length} lỗi thu thập / phân tích</summary>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                <b>{e.source}:</b> {e.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ConfigEditor() {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .fetchIdeaRadarConfig()
      .then((c) => setText(JSON.stringify(c, null, 2)))
      .catch(() => setMsg('Không tải được cấu hình'));
  }, []);

  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setMsg('JSON không hợp lệ');
      return;
    }
    setSaving(true);
    try {
      const saved = await api.saveIdeaRadarConfig(parsed);
      setText(JSON.stringify(saved, null, 2));
      setMsg('Đã lưu — áp dụng từ lần chạy sau');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.config}>
      <p className={styles.muted}>
        Hồ sơ, từ khoá, quốc gia, ngưỡng phân tích, model Claude, trọng số chấm điểm. Telegram cấu hình qua biến môi trường{' '}
        <code>IDEA_RADAR_TELEGRAM_CHAT_ID</code> trên server (để trống = không gửi).
      </p>
      <textarea className={styles.textarea} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={28} />
      <div className={styles.actions}>
        {msg ? <span className={styles.muted}>{msg}</span> : null}
        <span className={styles.spacer} />
        <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving || !text}>
          {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
        </button>
      </div>
    </div>
  );
}

export function IdeaRadarView({ initial }: { initial: IdeaRadarOverview | null }) {
  const [overview, setOverview] = useState<IdeaRadarOverview | null>(initial);
  const [selected, setSelected] = useState<IdeaRadarRun | null>(initial?.latest ?? null);
  const [tab, setTab] = useState<Tab>('run');
  const [list, setList] = useState<IdeaRadarIdea[] | null>(null);
  const [cost, setCost] = useState<IdeaRadarCost | null>(null);
  const [error, setError] = useState<string | null>(initial ? null : 'Không tải được dữ liệu');
  const [busy, setBusy] = useState(false);

  const running = overview?.running || overview?.latest?.status === 'RUNNING';
  const latestStep = overview?.latest?.status === 'RUNNING' ? overview.latest.step : null;

  const reload = useCallback(async () => {
    try {
      const o = await api.fetchIdeaRadarOverview();
      setOverview(o);
      setSelected((cur) => (!cur || cur.id === o.latest?.id || cur.runDate === o.latest?.runDate ? o.latest : cur));
      setError(null);
    } catch {
      setError('Không tải được dữ liệu');
    }
  }, []);

  useEffect(() => {
    api.fetchIdeaRadarCost().then(setCost).catch(() => undefined);
  }, [overview?.latest?.status]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [running, reload]);

  useEffect(() => {
    if (tab !== 'shortlist' && tab !== 'all') return;
    setList(null);
    api
      .fetchIdeaRadarIdeas(tab === 'shortlist' ? 'shortlisted' : undefined)
      .then(setList)
      .catch(() => setError('Không tải được danh sách ý tưởng'));
  }, [tab]);

  const start = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api.startIdeaRadarRun(dryRun);
      if (!r.started) setError(r.message);
      setTimeout(() => void reload(), 1500);
      setOverview((o) => (o ? { ...o, running: true } : o));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không chạy được');
    } finally {
      setBusy(false);
    }
  };

  const mark = async (idea: IdeaRadarIdea, status: IdeaRadarIdeaStatus) => {
    const patch = (arr: IdeaRadarIdea[]) => arr.map((i) => (i.id === idea.id ? { ...i, status } : i));
    setSelected((r) => (r ? { ...r, ideas: patch(r.ideas) } : r));
    setList((l) => (l ? (tab === 'shortlist' && status !== 'shortlisted' ? l.filter((i) => i.id !== idea.id) : patch(l)) : l));
    try {
      await api.markIdeaRadarIdea(idea.id, status);
    } catch {
      setError('Không cập nhật được trạng thái');
    }
  };

  const pickRun = async (id: string) => {
    try {
      setSelected(await api.fetchIdeaRadarRun(id));
      setTab('run');
    } catch {
      setError('Không tải được lần chạy');
    }
  };

  const reportHtml = useMemo(() => (selected?.reportMd ? withLinks(renderMarkdown(selected.reportMd)) : ''), [selected?.reportMd]);
  const runs = overview?.runs ?? [];

  return (
    <div className={`page ${styles.page}`}>
      <div className={styles.head}>
        <h1>💡 App Idea Radar</h1>
        <div className={styles.headActions}>
          <button type="button" className={styles.btn} onClick={() => start(true)} disabled={busy || running} title="Không gọi Claude, không gửi Telegram">
            Dry-run
          </button>
          <button type="button" className={styles.primaryBtn} onClick={() => start(false)} disabled={busy || running}>
            {running ? 'Đang chạy…' : 'Chạy ngay'}
          </button>
        </div>
      </div>
      <p className={styles.lead}>
        Mỗi thứ Hai 07:00, quét App Store, Google Play, Reddit và Hacker News, tìm app đang lên hạng và những gì người dùng phàn nàn trong
        review 1–2★, rồi Claude gợi ý <strong>ý tưởng app một người làm được trong 2–4 tuần</strong>, có chấm điểm và bằng chứng.
        {cost ? (
          <span className={styles.cost}>
            {' '}
            Claude tháng này ≈ ${cost.totalUsd.toFixed(2)} / ${cost.budgetUsd} (ước tính, tính vào gói claude.ai).
          </span>
        ) : null}
      </p>

      {running ? (
        <div className={styles.progress} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          {latestStep ? (STEP_LABEL[latestStep] ?? latestStep) : 'Đang khởi động'}… (thường mất 15–30 phút, có thể rời trang)
        </div>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.tabs} role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? styles.tabActive : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'run' ? (
        selected ? (
          <>
            <RunSummary run={selected} />
            {selected.ideas.length ? (
              <ul className={styles.list}>
                {selected.ideas.map((idea, i) => (
                  <IdeaCard key={idea.id} idea={idea} rank={i + 1} onMark={mark} />
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>{selected.status === 'RUNNING' ? 'Ý tưởng sẽ hiện ở đây khi chạy xong.' : 'Kỳ này không có ý tưởng nào.'}</div>
            )}
            {runs.length > 1 ? (
              <section className={styles.history}>
                <h2>Các kỳ trước</h2>
                <ul>
                  {runs.map((r) => (
                    <li key={r.id}>
                      <button type="button" className={`${styles.linkBtn} ${r.id === selected.id ? styles.current : ''}`} onClick={() => pickRun(r.id)}>
                        {r.runDate}
                        {r.dryRun ? ' (dry-run)' : ''}
                      </button>{' '}
                      <span className={styles.muted}>{STATUS_LABEL[r.status]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <div className={styles.empty}>Chưa có lần chạy nào. Bấm “Dry-run” để thử pipeline hoặc “Chạy ngay” để chạy thật.</div>
        )
      ) : null}

      {tab === 'shortlist' || tab === 'all' ? (
        list === null ? (
          <div className={styles.empty}>Đang tải…</div>
        ) : list.length ? (
          <ul className={styles.list}>
            {list.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} onMark={mark} showRunDate />
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>{tab === 'shortlist' ? 'Chưa shortlist ý tưởng nào.' : 'Chưa có ý tưởng.'}</div>
        )
      ) : null}

      {tab === 'report' ? (
        selected?.reportMd ? (
          <section className={styles.report}>
            <div className={styles.actions}>
              <span className={styles.muted}>Báo cáo kỳ {selected.runDate}</span>
              <span className={styles.spacer} />
              <button type="button" className={styles.btn} onClick={() => download(`idea-radar-${selected.runDate}.md`, selected.reportMd ?? '')}>
                Tải .md
              </button>
            </div>
            <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: reportHtml }} />
          </section>
        ) : (
          <div className={styles.empty}>Chưa có báo cáo cho kỳ này.</div>
        )
      ) : null}

      {tab === 'config' ? <ConfigEditor /> : null}
    </div>
  );
}
