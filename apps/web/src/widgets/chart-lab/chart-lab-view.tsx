'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ChartLabStats, ChartSample, ChartStatRow } from '@web/shared/api/types';

import { ChartDetail } from './chart-detail';
import { DirectionBadge, ResultBadge, fmtChartTime, fmtPct, pctClass } from './chart-lab-parts';
import s from './chart-lab.module.css';

const api = createApiClient();

type DirFilter = 'ALL' | 'LONG' | 'SHORT' | 'NONE' | 'UNLABELED';

/** /chart-lab: upload chart screenshots, label them, see which setups really win, ask Claude about a chart. */
export function ChartLabView() {
  const [samples, setSamples] = useState<ChartSample[] | null>(null);
  const [stats, setStats] = useState<ChartLabStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
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

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (!images.length || uploading) return;
      setError(null);
      setUploading({ done: 0, total: images.length });
      let lastId: string | null = null;
      for (const [i, file] of images.entries()) {
        try {
          const [ref] = await api.uploadImagesR2([file]);
          if (!ref) throw new Error('Upload ảnh thất bại');
          const created = await api.createChartSample(ref);
          lastId = created.id;
          setSamples((prev) => [created, ...(prev ?? [])]);
        } catch (e) {
          setError(`${file.name}: ${e instanceof Error ? e.message : 'lỗi'}`);
        }
        setUploading({ done: i + 1, total: images.length });
      }
      setUploading(null);
      void api.fetchChartLabStats().then(setStats).catch(() => {});
      // One chart → open it straight away to label it.
      if (images.length === 1 && lastId) setSelectedId(lastId);
    },
    [uploading],
  );

  // Ctrl/Cmd+V a screenshot anywhere on the page (not while typing in the drawer).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (selectedId) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles, selectedId]);

  const onChanged = useCallback((updated: ChartSample) => {
    setSamples((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
    void api.fetchChartLabStats().then(setStats).catch(() => {});
  }, []);

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
        Thư viện chart của bạn. Upload ảnh chart, Claude tự đọc coin, khung giờ và thời điểm, hệ thống lấy giá Binance để chấm kết quả thật (sau 6/24/72 nến và TP/SL nào chạm
        trước). Gắn nhận định LONG/SHORT cùng tag cho từng chart để xem setup nào của bạn thắng nhiều. Mỗi lần nhờ phân tích chart mới, Claude sẽ so với các chart cũ giống nhất.
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
          Kéo thả ảnh vào đây, dán bằng Ctrl/⌘+V, hoặc chọn file (nhiều ảnh cùng lúc được). Mỗi ảnh mất ~10–20 giây để Claude đọc.
        </div>
        <div className={s.toolbarActions}>
          {uploading && (
            <span className={s.busyOverlay}>
              Đang đọc chart {Math.min(uploading.done + 1, uploading.total)}/{uploading.total}…
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
              <button key={x.id} type="button" className={s.tile} onClick={() => setSelectedId(x.id)}>
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
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

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
