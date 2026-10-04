import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApi } from '../lib/api';
import { can } from '../lib/session';
import { Icon, useAction } from '../components/ui';
import { useProject } from './ProjectLayout';

export function CandidateManager() {
  const { pid, api, candidates, role, reload } = useProject();
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await run(() => api.post(`/projects/${pid}/candidates`, { name, provider: provider || null }), '候補を追加しました');
    setName('');
    setProvider('');
    reload();
  }
  return (
    <div className="card">
      <div className="card-head">
        <h3>候補（Candidates）</h3>
        <small className="muted">{candidates.length}件</small>
      </div>
      <div className="list">
        {candidates.map((c) => (
          <div className="list-item" key={c.id}>
            <div className="grow">
              <b>{c.name}</b> {c.provider && <small className="muted">（{c.provider}）</small>}
              {c.status !== 'considering' && <span className={`badge ${c.status === 'chosen' ? 'ok' : c.status === 'rejected' ? 'fail' : ''}`} style={{ marginLeft: 6 }}>{{ shortlisted: '候補に残す', rejected: '見送り', chosen: '選択（人の判断）' }[c.status as string]}</span>}
            </div>
            {can(role, 'editor') && (
              <select
                aria-label={`${c.name}の状態`}
                value={c.status === 'chosen' ? 'chosen' : c.status}
                disabled={c.status === 'chosen'}
                onChange={async (e) => {
                  await run(() => api.patch(`/candidates/${c.id}`, { status: e.target.value }));
                  reload();
                }}
                style={{ width: 140 }}
              >
                <option value="considering">検討中</option>
                <option value="shortlisted">候補に残す</option>
                <option value="rejected">見送り</option>
                {c.status === 'chosen' && <option value="chosen">選択済み</option>}
              </select>
            )}
            {can(role, 'editor') && (
              <button
                className="btn ghost small"
                aria-label={`${c.name}を削除`}
                onClick={async () => {
                  if (!confirm(`「${c.name}」と関連するFactを削除しますか？`)) return;
                  await run(() => api.del(`/candidates/${c.id}`), '削除しました');
                  reload();
                }}
              >
                <Icon name="trash" />
              </button>
            )}
          </div>
        ))}
      </div>
      {can(role, 'editor') && (
        <form className="row" style={{ marginTop: 12 }} onSubmit={add}>
          <input aria-label="候補名" placeholder="候補名（例: 製品名・ベンダー名）" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 2, minWidth: 160 }} maxLength={120} />
          <input aria-label="提供元" placeholder="提供元（任意）" value={provider} onChange={(e) => setProvider(e.target.value)} style={{ flex: 1, minWidth: 120 }} maxLength={120} />
          <button className="btn primary" disabled={busy || !name.trim()}>
            <Icon name="plus" /> 追加
          </button>
        </form>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>「選択」は Decision Brief で人が判断を記録したときにだけ設定されます。AIが候補を選ぶことはありません。</p>
    </div>
  );
}

export function OverviewPage() {
  const { ws, pid, project, candidates, missing } = useProject();
  const sources = useApi<any[]>(`/api/w/${ws}/projects/${pid}/sources`, [pid]);
  const facts = useApi<any[]>(`/api/w/${ws}/projects/${pid}/facts`, [pid]);
  const criteria = useApi<any[]>(`/api/w/${ws}/projects/${pid}/criteria`, [pid]);
  const decision = useApi<any>(`/api/w/${ws}/projects/${pid}/decision`, [pid]);
  const base = `/w/${ws}/p/${pid}`;
  const f = facts.data ?? [];
  const unconfirmed = f.filter((x) => x.reviewState === 'candidate' && x.kind === 'fact' && x.attributeKey).length;
  const steps = [
    { done: candidates.length >= 2, label: '候補を2つ以上登録', to: `${base}` },
    { done: (sources.data?.length ?? 0) > 0, label: 'URL・PDF・スクショを取り込む', to: `${base}/import` },
    { done: f.some((x) => x.reviewState === 'confirmed'), label: '抽出されたFactを根拠と照合して確認', to: `${base}/review` },
    { done: (missing?.conflicts.length ?? 1) === 0 && (missing?.missing.length ?? 1) === 0, label: 'Unknown / Conflict を解消（または把握）', to: `${base}/questions` },
    { done: (criteria.data?.filter((c) => c.status === 'active').length ?? 0) > 0, label: 'Criteria と Weight を自分で決める', to: `${base}/criteria` },
    { done: decision.data?.status === 'decided' || decision.data?.status === 'reviewed', label: '判断を記録して Decision Brief を出力', to: `${base}/decision` },
  ];
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid cols-4">
        <div className="card stat">
          <small className="muted">候補</small>
          <b>{candidates.length}</b>
        </div>
        <div className="card stat">
          <small className="muted">ソース</small>
          <b>{sources.data?.length ?? '–'}</b>
        </div>
        <div className="card stat">
          <small className="muted">未確認のFact</small>
          <b>{unconfirmed}</b>
        </div>
        <div className="card stat">
          <small className="muted">Unknown / Conflict</small>
          <b>
            {missing?.missing.length ?? '–'} / {missing?.conflicts.length ?? '–'}
          </b>
        </div>
      </div>
      <div className="grid cols-2">
        <div className="card">
          <h3>進め方</h3>
          <ol className="list" style={{ paddingLeft: 0, listStyle: 'none', margin: 0 }}>
            {steps.map((s, i) => (
              <li className="list-item" key={i}>
                <span className={`badge ${s.done ? 'ok' : ''}`}>{s.done ? '完了' : i + 1}</span>
                <Link className="grow" to={s.to}>
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
        </div>
        <CandidateManager />
      </div>
      <div className="card hide-desktop">
        <h3>メニュー</h3>
        <div className="list">
          {[
            ['review', '根拠レビュー'],
            ['attributes', '比較項目'],
            ['criteria', 'Criteria・Scenario'],
            ['activity', '履歴'],
            ['settings', '設定'],
          ].map(([to, l]) => (
            <Link key={to} className="list-item" to={`${base}/${to}`}>
              {l}
            </Link>
          ))}
        </div>
      </div>
      {project.category && <small className="muted">カテゴリ: {project.category}</small>}
    </div>
  );
}
