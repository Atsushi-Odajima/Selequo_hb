import { useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { useApi } from '../lib/api';
import { can } from '../lib/session';
import { EvidenceDrawer } from '../components/Evidence';
import { QualityBadge, StateBadge, useAction } from '../components/ui';
import { useProject } from './ProjectLayout';
import { formatValue } from '@shared/normalize';

type Region = { x: number; y: number; w: number; h: number };

function RegionPicker({ src, onRegion }: { src: string; onRegion: (r: Region | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const pos = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const update = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    setRegion(r);
    return r;
  };
  return (
    <div
      ref={ref}
      className="shot"
      data-testid="region-picker"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setStart(pos(e));
      }}
      onPointerMove={(e) => start && update(start, pos(e))}
      onPointerUp={(e) => {
        if (!start) return;
        const r = update(start, pos(e));
        setStart(null);
        onRegion(r.w > 0.01 && r.h > 0.01 ? r : null);
      }}
    >
      <img src={src} alt="スクリーンショット（ドラッグで領域を選択）" draggable={false} />
      {region && <div className="region" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }} />}
    </div>
  );
}

function ScreenshotTranscriber({ onDone }: { onDone: () => void }) {
  const { ws, pid, api, candidates } = useProject();
  const sources = useApi<any[]>(`/api/w/${ws}/projects/${pid}/sources`, [pid]);
  const attrs = useApi<any[]>(`/api/w/${ws}/projects/${pid}/attributes`, [pid]);
  const shots = (sources.data ?? []).filter((s) => (s.type === 'screenshot' || s.type === 'image') && s.status === 'ready');
  const [sel, setSel] = useState<string>('');
  const [region, setRegion] = useState<Region | null>(null);
  const [f, setF] = useState({ candidateId: '', attributeKey: '', label: '', value: '' });
  const { run, busy } = useAction();
  const shot = shots.find((s) => s.id === sel) ?? shots[0];
  if (!shots.length) return null;
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await run(
      () => api.post(`/projects/${pid}/facts`, { candidateId: f.candidateId || shot.candidateId, attributeKey: f.attributeKey || null, label: f.label || null, value: f.value, sourceId: shot.id, region }),
      'スクショの領域を根拠としてFactを記録しました（未確認）',
    );
    if (r) {
      setF({ ...f, value: '', label: '' });
      onDone();
    }
  }
  return (
    <div className="card">
      <div className="card-head">
        <h2>スクリーンショットから値を記録</h2>
        <select value={shot.id} onChange={(e) => setSel(e.target.value)} style={{ width: 260 }} aria-label="スクリーンショットを選択">
          {shots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} — {candidates.find((c) => c.id === s.candidateId)?.name ?? '候補未設定'}
            </option>
          ))}
        </select>
      </div>
      <div className="grid cols-2">
        <div>
          <RegionPicker key={shot.id} src={shot.fileUrl} onRegion={setRegion} />
          <small className="muted">画像上をドラッグして根拠となる領域を選択します。{region ? '（領域を選択済み）' : ''}</small>
        </div>
        <form className="stack" onSubmit={save}>
          <label className="field">
            候補
            <select value={f.candidateId || shot.candidateId || ''} onChange={(e) => setF({ ...f, candidateId: e.target.value })} required>
              <option value="" disabled>
                選択
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            比較項目
            <select value={f.attributeKey} onChange={(e) => setF({ ...f, attributeKey: e.target.value })}>
              <option value="">（項目なし・メモ）</option>
              {attrs.data?.filter((a) => a.status === 'active').map((a) => (
                <option key={a.key} value={a.key}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            ラベル（画像内の表記）
            <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="例: セール価格" />
          </label>
          <label className="field">
            値（画像に書かれている通りに）
            <input required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="例: ¥127,600（税込）" />
          </label>
          <button className="btn primary" disabled={busy || !f.value}>
            記録する
          </button>
        </form>
      </div>
    </div>
  );
}

export function ReviewPage() {
  const { ws, pid, api, candidates, role, reloadMissing } = useProject();
  const [state, setState] = useState<'candidate' | 'confirmed' | 'rejected' | 'all'>('candidate');
  const [kind, setKind] = useState<'fact' | 'opinion'>('fact');
  const q = new URLSearchParams({ kind, ...(state !== 'all' ? { state } : {}) });
  const facts = useApi<any[]>(`/api/w/${ws}/projects/${pid}/facts?${q}`, [pid, state, kind]);
  const attrs = useApi<any[]>(`/api/w/${ws}/projects/${pid}/attributes`, [pid]);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { run, busy } = useAction();
  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const f of facts.data ?? []) (m.get(f.candidateId) ?? m.set(f.candidateId, []).get(f.candidateId)!).push(f);
    return m;
  }, [facts.data]);
  const attrName = (k: string | null) => (k ? (attrs.data?.find((a) => a.key === k)?.displayName ?? k) : null);
  const reviewer = can(role, 'reviewer');
  async function bulk(action: 'confirm' | 'reject') {
    const ids = [...selected];
    const res = await run(() => api.post(`/projects/${pid}/facts/bulk-review`, { factIds: ids, action }));
    if (res) {
      const failed = (res as any[]).filter((r) => !r.ok).length;
      setSelected(new Set());
      void facts.reload();
      reloadMissing();
      if (failed) alert(`${failed}件は処理できませんでした（出典なし・Opinion など）`);
    }
  }
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="callout">
        抽出されたFactは<b>未確認（Candidate）</b>として登録されます。元の文脈と照合して Confirm / Reject してください。スコアは既定で Confirmed のFactのみを使います。
      </div>
      <ScreenshotTranscriber onDone={() => void facts.reload()} />
      <div className="card">
        <div className="card-head">
          <div className="row">
            <div className="segmented">
              {(
                [
                  ['candidate', '未確認'],
                  ['confirmed', 'Confirmed'],
                  ['rejected', 'Rejected'],
                  ['all', 'すべて'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={state === k ? 'on' : ''} onClick={() => setState(k)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="segmented">
              <button className={kind === 'fact' ? 'on' : ''} onClick={() => setKind('fact')}>
                Fact
              </button>
              <button className={kind === 'opinion' ? 'on' : ''} onClick={() => setKind('opinion')}>
                Opinion（意見）
              </button>
            </div>
          </div>
          {reviewer && kind === 'fact' && (
            <div className="row">
              <button className="btn small" onClick={() => setSelected(new Set((facts.data ?? []).filter((f) => f.attributeKey && f.reviewState === 'candidate').map((f) => f.id)))}>
                項目ありを全選択
              </button>
              <button className="btn primary small" disabled={!selected.size || busy} onClick={() => bulk('confirm')}>
                選択をConfirm（{selected.size}）
              </button>
              <button className="btn danger small" disabled={!selected.size || busy} onClick={() => bulk('reject')}>
                Reject
              </button>
            </div>
          )}
        </div>
        {kind === 'opinion' && <p className="muted" style={{ marginBottom: 8 }}>意見・レビューは比較表には入りません。参考情報として出典付きで保持します。</p>}
        {facts.data?.length === 0 && <div className="empty">該当するFactはありません</div>}
        {[...grouped.entries()].map(([cid, list]) => (
          <div key={cid} style={{ marginBottom: 18 }}>
            <h3 style={{ margin: '8px 0' }}>{candidates.find((c) => c.id === cid)?.name}</h3>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    {reviewer && kind === 'fact' && <th style={{ width: 32 }} />}
                    <th>項目</th>
                    <th>抽出値</th>
                    <th>正規化</th>
                    <th>出典</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((f) => (
                    <tr key={f.id} data-testid="fact-row">
                      {reviewer && kind === 'fact' && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label="選択"
                            checked={selected.has(f.id)}
                            onChange={(e) => {
                              const s = new Set(selected);
                              e.target.checked ? s.add(f.id) : s.delete(f.id);
                              setSelected(s);
                            }}
                          />
                        </td>
                      )}
                      <td>
                        {attrName(f.attributeKey) ?? (
                          <span className="muted">
                            未対応の項目
                            {can(role, 'editor') && (
                              <select
                                aria-label="比較項目に割り当て"
                                defaultValue=""
                                style={{ display: 'block', marginTop: 4, minHeight: 28, padding: '2px 6px' }}
                                onChange={async (e) => {
                                  await run(() => api.patch(`/facts/${f.id}`, { attributeKey: e.target.value }));
                                  void facts.reload();
                                }}
                              >
                                <option value="" disabled>
                                  割り当て…
                                </option>
                                {attrs.data?.filter((a) => a.status === 'active').map((a) => (
                                  <option key={a.key} value={a.key}>
                                    {a.displayName}
                                  </option>
                                ))}
                              </select>
                            )}
                          </span>
                        )}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {f.rawLabel}
                        </div>
                      </td>
                      <td>
                        <button className="btn ghost small" style={{ padding: 0, height: 'auto', fontWeight: 600, textAlign: 'left', whiteSpace: 'normal' }} onClick={() => setOpen(f.id)}>
                          {f.rawValue}
                        </button>
                      </td>
                      <td>{f.normalizedValue ? formatValue(f.normalizedValue) : <span className="muted">{f.issue ?? '-'}</span>}</td>
                      <td style={{ fontSize: 12 }}>
                        <QualityBadge q={f.sourceQuality ?? 'unknown'} /> {f.sourceRange.type === 'pdf' ? `p.${f.sourceRange.page}` : f.sourceRange.type === 'image' ? '画像領域' : ''}
                        <div className="muted truncate" style={{ maxWidth: 220 }}>
                          {f.sourceTitle}
                        </div>
                      </td>
                      <td>
                        <StateBadge state={f.reviewState} />
                        {f.extractedBy?.startsWith('ai:') && <span className="badge ai" style={{ marginLeft: 4 }}>AI</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <EvidenceDrawer
        factId={open}
        onClose={() => setOpen(null)}
        onChanged={() => {
          void facts.reload();
          reloadMissing();
        }}
      />
    </div>
  );
}
