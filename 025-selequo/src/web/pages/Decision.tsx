import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '../lib/api';
import { can } from '../lib/session';
import { BriefView } from '../components/BriefView';
import { fmtDate, Icon, Loading, useAction } from '../components/ui';
import { useProject } from './ProjectLayout';

export function DecisionPage() {
  const { ws, pid, api, candidates, role, reload } = useProject();
  const decision = useApi<any>(`/api/w/${ws}/projects/${pid}/decision`, [pid]);
  const preview = useApi<any>(`/api/w/${ws}/projects/${pid}/brief/preview`, [pid]);
  const briefs = useApi<any[]>(`/api/w/${ws}/projects/${pid}/briefs`, [pid]);
  const scen = useApi<any[]>(`/api/w/${ws}/projects/${pid}/scenarios`, [pid]);
  const { run, busy } = useAction();
  const d = decision.data;
  const [f, setF] = useState({ chosenCandidateId: '', scenarioId: '', reason: '', assumptions: '', expectedOutcome: '', reviewInDays: 90 });
  const [rv, setRv] = useState({ actualResult: '', lessons: '' });
  useEffect(() => {
    if (d) setF({ chosenCandidateId: d.chosenCandidateId ?? '', scenarioId: d.scenarioId ?? '', reason: d.reason ?? '', assumptions: d.assumptions ?? '', expectedOutcome: d.expectedOutcome ?? '', reviewInDays: 90 });
  }, [d]);
  const editor = can(role, 'editor');
  const refresh = () => {
    void decision.reload();
    void preview.reload();
    void briefs.reload();
    reload();
  };
  async function save(e: FormEvent, finalize: boolean) {
    e.preventDefault();
    if (finalize && !confirm('この内容で判断を記録します。判断したのはあなたです（AIではありません）。よろしいですか？')) return;
    const ok = await run(
      () => api.put(`/projects/${pid}/decision`, { ...f, chosenCandidateId: f.chosenCandidateId || null, scenarioId: f.scenarioId || null, reviewInDays: Number(f.reviewInDays) || undefined, finalize }),
      finalize ? '判断を記録しました' : '下書きを保存しました',
    );
    if (ok) refresh();
  }
  const exportUrl = (format: string, briefId?: string) => `/api/w/${ws}/projects/${pid}/brief/export?format=${format}${briefId ? `&briefId=${briefId}` : ''}`;
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="stack" style={{ gap: 20 }}>
        <div className="card">
          <h2>判断を記録（Decision Record）</h2>
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            比較表・根拠・Scenario を確認したうえで、あなたが選んだ候補と理由を記録します。Selequo（AI）が候補を決定することはありません。
          </p>
          {d?.status === 'decided' || d?.status === 'reviewed' ? (
            <div className="callout ok" style={{ marginBottom: 12 }}>
              {d.decidedByName} さんが {fmtDate(d.decidedAt, true)} に「{candidates.find((c) => c.id === d.chosenCandidateId)?.name}」を選択しました。振り返り予定日: {d.reviewDate ?? '-'}
            </div>
          ) : null}
          {editor && d?.status !== 'reviewed' ? (
            <form className="stack" onSubmit={(e) => save(e, false)}>
              <label className="field">
                選んだ候補
                <select value={f.chosenCandidateId} onChange={(e) => setF({ ...f, chosenCandidateId: e.target.value })}>
                  <option value="">（未選択）</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                判断の前提にした Scenario
                <select value={f.scenarioId} onChange={(e) => setF({ ...f, scenarioId: e.target.value })}>
                  <option value="">既定のWeight</option>
                  {scen.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                理由
                <textarea required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="なぜこの候補を選ぶのか（比較表のどの違いを重視したか）" />
              </label>
              <label className="field">
                前提（Assumptions）
                <textarea value={f.assumptions} onChange={(e) => setF({ ...f, assumptions: e.target.value })} rows={2} />
              </label>
              <label className="field">
                期待する結果（Expected outcome）
                <textarea value={f.expectedOutcome} onChange={(e) => setF({ ...f, expectedOutcome: e.target.value })} rows={2} />
              </label>
              <label className="field">
                振り返りまでの日数
                <input type="number" min={1} max={3650} value={f.reviewInDays} onChange={(e) => setF({ ...f, reviewInDays: Number(e.target.value) })} />
              </label>
              <div className="row">
                <button className="btn" disabled={busy} type="submit">
                  下書き保存
                </button>
                <button className="btn accent" disabled={busy || !f.chosenCandidateId || !f.reason.trim()} type="button" onClick={(e) => save(e as unknown as FormEvent, true)}>
                  <Icon name="check" /> この内容で判断を記録
                </button>
              </div>
            </form>
          ) : null}
        </div>
        {(d?.status === 'decided' || d?.status === 'reviewed') && (
          <div className="card">
            <h2>振り返り（Decision Review）</h2>
            {d.status === 'reviewed' ? (
              <dl className="kv">
                <dt>実際の結果</dt>
                <dd>{d.actualResult}</dd>
                <dt>学び</dt>
                <dd>{d.lessons ?? '-'}</dd>
                <dt>振り返り日</dt>
                <dd>{fmtDate(d.reviewedAt, true)}</dd>
              </dl>
            ) : editor ? (
              <form
                className="stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await run(() => api.post(`/projects/${pid}/decision/review`, rv), '振り返りを記録しました');
                  if (ok) refresh();
                }}
              >
                <p className="muted" style={{ fontSize: 12 }}>振り返り予定日: {d.reviewDate}。予定日より前でも記録できます。</p>
                <label className="field">
                  実際の結果
                  <textarea required value={rv.actualResult} onChange={(e) => setRv({ ...rv, actualResult: e.target.value })} />
                </label>
                <label className="field">
                  学び（Lessons）
                  <textarea value={rv.lessons} onChange={(e) => setRv({ ...rv, lessons: e.target.value })} rows={2} />
                </label>
                <button className="btn primary" disabled={busy}>
                  振り返りを記録
                </button>
              </form>
            ) : (
              <p className="muted">振り返りはまだ記録されていません。</p>
            )}
          </div>
        )}
        <div className="card">
          <div className="card-head">
            <h2>Decision Brief の出力</h2>
          </div>
          <div className="row">
            {['pdf', 'html', 'md', 'txt', 'json'].map((fmt) => (
              <a key={fmt} className="btn small" href={exportUrl(fmt)} download>
                <Icon name="download" /> {fmt.toUpperCase()}
              </a>
            ))}
          </div>
          {editor && (
            <button className="btn primary" style={{ marginTop: 12 }} disabled={busy} onClick={async () => { await run(() => api.post(`/projects/${pid}/briefs`), '新しい版として保存しました'); refresh(); }}>
              この内容を版として保存
            </button>
          )}
          <div className="list" style={{ marginTop: 10 }}>
            {briefs.data?.map((b) => (
              <div className="list-item" key={b.id}>
                <span className="grow">
                  v{b.version}・{fmtDate(b.createdAt, true)}・{b.createdByName}
                </span>
                <span className={`badge ${b.reviewState === 'approved' ? 'ok' : b.reviewState === 'in_review' ? 'candidate' : ''}`}>{{ draft: '下書き', in_review: 'レビュー中', approved: '承認済み' }[b.reviewState as string]}</span>
                {can(role, 'reviewer') && (
                  <select aria-label="レビュー状態" value={b.reviewState} style={{ width: 120 }} onChange={async (e) => { await run(() => api.patch(`/briefs/${b.id}`, { reviewState: e.target.value })); void briefs.reload(); }}>
                    <option value="draft">下書き</option>
                    <option value="in_review">レビュー中</option>
                    <option value="approved">承認済み</option>
                  </select>
                )}
                <a className="btn ghost small" href={exportUrl('pdf', b.id)} download aria-label="PDF">
                  <Icon name="download" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card">{preview.data ? <BriefView b={preview.data} /> : <Loading />}</div>
    </div>
  );
}
