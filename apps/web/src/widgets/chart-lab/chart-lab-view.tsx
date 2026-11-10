'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ChartLabStats, ChartSample, ChartStatRow, ImageRef, LiveReply } from '@web/shared/api/types';

import { ChartDetail } from './chart-detail';
import { NewChartDialog } from './new-chart-dialog';
import { DirectionBadge, ResultBadge, fmtChartTime, fmtPct, pctClass } from './chart-lab-parts';
import s from './chart-lab.module.css';

const api = createApiClient();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type DirFilter = 'ALL' | 'LONG' | 'SHORT' | 'NONE' | 'UNLABELED';

/** /chart-lab: upload chart screenshots, label them, see which setups really win, ask Claude about a chart. */
export function ChartLabView() {
  const [samples, setSamples] = useState<ChartSample[] | null>(null);
  const [stats, setStats] = useState<ChartLabStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [queue, setQueue] = useState<ImageRef[]>([]);
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string>('');
  const [dirFilter, setDirFilter] = useState<DirFilter>('ALL');
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([api.fetchChartSamples(), api.fetchChartLabStats()]);
      setSamples(list);
      setStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Upload to R2 only; each image then gets the form (nothing is saved until the user clicks Lưu). */
  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (!images.length || uploading) return;
      setError(null);
      setUploading({ done: 0, total: images.length });
      const refs: ImageRef[] = [];
      for (const [i, file] of images.entries()) {
        try {
          const [ref] = await api.uploadImagesR2([file]);
          if (ref) refs.push(ref);
        } catch (e) {
          setError(`${file.name}: ${e instanceof Error ? e.message : 'upload lỗi'}`);
        }
        setUploading({ done: i + 1, total: images.length });
      }
      setUploading(null);
      if (refs.length) setQueue((q) => [...q, ...refs]);
    },
    [uploading],
  );

  // Ctrl/Cmd+V a screenshot anywhere on the page (not while typing in the drawer).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (selectedId || queue.length) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles, selectedId, queue.length]);

  const onChanged = useCallback((updated: ChartSample) => {
    setSamples((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
    void api.fetchChartLabStats().then(setStats).catch(() => {});
  }, []);

  const onCreated = useCallback((created: ChartSample) => {
    setSamples((prev) => [created, ...(prev ?? [])]);
    setQueue((q) => q.slice(1));
    void api.fetchChartLabStats().then(setStats).catch(() => {});
  }, []);

  /** Analyze from the list: runs in the background, the badge updates when Claude is done. */
  const analyze = useCallback(
    async (id: string) => {
      setAnalyzing((cur) => new Set(cur).add(id));
      try {
        const { conversationId } = await api.analyzeChartSample(id);
        setSamples((prev) => (prev ?? []).map((x) => (x.id === id ? { ...x, conversationId } : x)));
        const started = Date.now();
        await sleep(1500);
        while (Date.now() - started < 8 * 60_000) {
          const l: LiveReply | null = await api.getLiveReply(conversationId).catch(() => null);
          if (l && !l.active) break;
          await sleep(2000);
        }
        const updated = await api.fetchChartSample(id);
        onChanged(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Không gọi được Claude');
      } finally {
        setAnalyzing((cur) => {
          const n = new Set(cur);
          n.delete(id);
          return n;
        });
      }
    },
    [onChanged],
  );

  const onDeleted = useCallback((id: string) => {
    setSamples((prev) => (prev ?? []).filter((x) => x.id !== id));
    setSelectedId(null);
    void api.fetchChartLabStats().then(setStats).catch(() => {});
  }, []);

  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of samples ?? []) for (const t of x.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return Array.from(m, ([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  }, [samples]);

  const visible = useMemo(() => {
    const q = search.trim().toUpperCase();
    return (samples ?? []).filter((x) => {
      if (tagFilter && !x.tags.includes(tagFilter)) return false;
      if (q && !(x.symbol ?? '').includes(q)) return false;
      if (dirFilter === 'UNLABELED') return x.direction == null;
      if (dirFilter !== 'ALL') return x.direction === dirFilter;
      return true;
    });
  }, [samples, tagFilter, dirFilter, search]);

  const selected = samples?.find((x) => x.id === selectedId) ?? null;

  return (
    <div className={`page ${s.page}`}>
      <h1>🧪 Chart Lab</h1>
      <p className={s.lead}>
        Kho chart của bạn. Upload ảnh rồi ghi phân tích sơ bộ (coin, khung, thời điểm, hướng, giá vào, TP, SL, tag, nhận xét). Hệ thống lấy giá Binance để chấm kết quả thật
        (sau 6/24/72 nến, TP hay SL chạm trước). Claude chỉ chạy khi bạn bấm <strong>🔍 Analyze</strong> trên một chart: Claude đánh giá phân tích của bạn, phân tích lại chart,
        so với các chart cũ giống nhất và tóm tắt bài học.
      </p>

      <div
        className={`${s.drop} ${dragOver ? s.dropActive : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className={s.dropText}>
          <strong>＋ Thêm chart</strong>
          Kéo thả ảnh vào đây, dán bằng Ctrl/⌘+V, hoặc chọn file (nhiều ảnh cùng lúc được), rồi điền phân tích của bạn cho từng ảnh.
        </div>
        <div className={s.toolbarActions}>
          {uploading && (
            <span className={s.busyOverlay}>
              Đang upload {Math.min(uploading.done + 1, uploading.total)}/{uploading.total}…
            </span>
          )}
          <button type="button" className={s.primaryBtn} onClick={() => fileRef.current?.click()} disabled={!!uploading}>
            Chọn ảnh
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
      </div>
      {error && <p className={s.error}>{error}</p>}

      {stats && <StatsCard stats={stats} activeTag={tagFilter} onTag={(t) => setTagFilter((cur) => (cur === t ? '' : t))} />}

      <section className={s.card}>
        <div className={s.toolbar}>
          <h2 className={s.cardTitle}>
            Chart ({visible.length}
            {samples && visible.length !== samples.length ? `/${samples.length}` : ''})
          </h2>
          <div className={s.filters}>
            <input className={s.input} placeholder="Tìm coin…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 130 }} />
            <select className={s.select} value={dirFilter} onChange={(e) => setDirFilter(e.target.value as DirFilter)}>
              <option value="ALL">Mọi nhận định</option>
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
              <option value="NONE">Đứng ngoài</option>
              <option value="UNLABELED">Chưa gắn</option>
            </select>
            <select className={s.select} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="">Mọi tag</option>
              {allTags.map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag} ({t.n})
                </option>
              ))}
            </select>
          </div>
        </div>
        {samples == null ? (
          <p className={s.muted}>Đang tải…</p>
        ) : visible.length === 0 ? (
          <p className={s.muted}>{samples.length ? 'Không có chart nào khớp bộ lọc.' : 'Chưa có chart nào. Thêm chart đầu tiên ở khung phía trên.'}</p>
        ) : (
          <div className={s.grid}>
            {visible.map((x) => (
              <div
                key={x.id}
                role="button"
                tabIndex={0}
                className={s.tile}
                onClick={() => setSelectedId(x.id)}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedId(x.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={s.thumb} src={x.imageUrl} alt={`${x.symbol ?? 'chart'} ${x.interval ?? ''}`} loading="lazy" />
                <div className={s.tileBody}>
                  <div className={s.tileTitle}>
                    <span>{x.symbol ?? '?'}</span>
                    <span className={s.muted}>{x.interval ?? ''}</span>
                    <span style={{ flex: 1 }} />
                    <DirectionBadge direction={x.direction} />
                  </div>
                  <div className={s.tileMeta}>
                    {fmtChartTime(x.chartTime)} · <ResultBadge sample={x} />
                  </div>
                  {x.tags.length > 0 && (
                    <div className={s.tileTags}>
                      {x.tags.slice(0, 4).map((t) => (
                        <span key={t} className={s.tag}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={s.tileFoot}>
                    {x.analyzedAt ? <span className={`${s.badge} ${s.badgeAi}`}>🧪 đã Analyze</span> : <span className={s.muted}>chưa Analyze</span>}
                    <button
                      type="button"
                      className={s.analyzeBtn}
                      disabled={analyzing.has(x.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        void analyze(x.id);
                      }}
                    >
                      {analyzing.has(x.id) ? 'Đang phân tích…' : x.analyzedAt ? '🔍 Analyze lại' : '🔍 Analyze'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {queue.length > 0 && (
        <NewChartDialog
          images={queue}
          allTags={allTags.map((t) => t.tag)}
          onSaved={onCreated}
          onSkip={() => setQueue((q) => q.slice(1))}
          onClose={() => setQueue([])}
        />
      )}

      {selected && (
        <ChartDetail
          key={selected.id}
          sample={selected}
          allTags={allTags.map((t) => t.tag)}
          onClose={() => setSelectedId(null)}
          onChanged={onChanged}
          onDeleted={onDeleted}
          onOpen={(id) => setSelectedId(id)}
        />
      )}
    </div>
  );
}

function StatsCard({ stats, activeTag, onTag }: { stats: ChartLabStats; activeTag: string; onTag: (tag: string) => void }) {
  const long = stats.byDirection.find((d) => d.key === 'LONG');
  const short = stats.byDirection.find((d) => d.key === 'SHORT');
  const tile = (label: string, r: ChartStatRow | undefined) => (
    <div className={s.statTile}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue}>{r?.tpWinRate != null ? `${r.tpWinRate}%` : '—'}</div>
      <div className={s.statNote}>{r && r.tp + r.sl ? `TP trước SL · ${r.tp}/${r.tp + r.sl} lệnh` : 'chưa có lệnh ngã ngũ'}</div>
    </div>
  );
  return (
    <section className={s.card}>
      <div className={s.toolbar}>
        <h2 className={s.cardTitle}>Thống kê nhận định của bạn</h2>
        <span className={s.muted}>
          {stats.total} chart · {stats.labeled} đã gắn LONG/SHORT · {stats.pending} đang chờ kết quả
        </span>
      </div>
      <div className={s.statsGrid}>
        {tile('Tất cả', stats.overall)}
        {tile('LONG', long)}
        {tile('SHORT', short)}
        <div className={s.statTile}>
          <div className={s.statLabel}>Đúng hướng sau 24 nến</div>
          <div className={s.statValue}>{stats.overall.winRate24 != null ? `${stats.overall.winRate24}%` : '—'}</div>
          <div className={s.statNote}>
            n={stats.overall.n24} · TB {fmtPct(stats.overall.avgRet24)}
          </div>
        </div>
      </div>
      {stats.byTag.length > 0 ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Tag (bấm để lọc)</th>
                <th>Mẫu</th>
                <th>TP trước SL</th>
                <th>Đúng hướng 24 nến</th>
                <th>TB sau 24 nến</th>
                <th>TB chạy được</th>
                <th>TB đi ngược</th>
              </tr>
            </thead>
            <tbody>
              {stats.byTag.map((r) => (
                <tr key={r.key} className={`${s.rowClick} ${activeTag === r.key ? s.rowActive : ''}`} onClick={() => onTag(r.key)}>
                  <td>
                    <span className={s.tag}>{r.key}</span>
                  </td>
                  <td>{r.n}</td>
                  <td>
                    {r.tpWinRate != null ? `${r.tpWinRate}%` : '—'} <span className={s.muted}>({r.tp}/{r.tp + r.sl})</span>
                  </td>
                  <td>
                    {r.winRate24 != null ? `${r.winRate24}%` : '—'} <span className={s.muted}>(n={r.n24})</span>
                  </td>
                  <td className={pctClass(r.avgRet24)}>{fmtPct(r.avgRet24)}</td>
                  <td className={s.pos}>{fmtPct(r.avgFav24)}</td>
                  <td className={s.neg}>{fmtPct(r.avgAdv24)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={s.muted}>Gắn LONG/SHORT và tag cho chart để xem tỉ lệ thắng theo từng setup.</p>
      )}
    </section>
  );
}
