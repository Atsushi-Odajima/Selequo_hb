import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useApi, wsApi } from '../lib/api';
import { can, useRole } from '../lib/session';
import { ErrorBox, fmtDate, Icon, Loading, Modal, useAction } from '../components/ui';

const CATEGORIES = [
  { v: 'laptop', l: 'PC・家電' },
  { v: 'saas', l: 'SaaS・業務ツール' },
  { v: 'vendor', l: '外注先・ベンダー' },
  { v: 'venue', l: 'ホテル・会場' },
  { v: 'property', l: '物件情報' },
  { v: 'supplier', l: '仕入先・サービス' },
  { v: 'other', l: 'その他' },
];

export function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ws } = useParams();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const [f, setF] = useState({ title: '', category: 'laptop', purpose: '', deadline: '', currency: 'JPY' });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = await run(() => wsApi(ws!).post('/projects', { ...f, deadline: f.deadline || null }), 'プロジェクトを作成しました');
    if (p) nav(`/w/${ws}/p/${p.id}/import`);
  }
  return (
    <Modal open={open} onClose={onClose} title="新しい比較を作成">
      <form className="stack" onSubmit={submit}>
        <label className="field">
          タイトル
          <input required maxLength={120} placeholder="例: 出張用ノートPCの比較" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <label className="field">
          カテゴリ <span className="hint">比較項目の初期セットに使います（あとで自由に変更できます）</span>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c.v} value={c.v}>
                {c.l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          目的
          <textarea maxLength={2000} placeholder="何を、何のために決めるのか" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
        </label>
        <div className="form-grid">
          <label className="field">
            期限
            <input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
          </label>
          <label className="field">
            通貨
            <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              <option>JPY</option>
              <option>USD</option>
              <option>EUR</option>
            </select>
          </label>
        </div>
        <p className="callout">医療・法律・投資・保険などの高リスクな判断を自動で決定する用途には使えません。Selequoは判断材料を整理し、決定は人が行います。</p>
        <button className="btn primary" disabled={busy}>
          作成して情報を取り込む
        </button>
      </form>
    </Modal>
  );
}

export function ProjectsPage() {
  const { ws } = useParams();
  const role = useRole(ws);
  const [sp, setSp] = useSearchParams();
  const { data, error, loading } = useApi<any[]>(`/api/w/${ws}/projects`, [ws]);
  const due = useApi<any[]>(`/api/w/${ws}/reviews/due`, [ws]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (sp.get('new')) {
      setOpen(true);
      sp.delete('new');
      setSp(sp, { replace: true });
    }
  }, [sp, setSp]);
  return (
    <div className="content">
      <section className="hero" style={{ marginBottom: 24 }}>
        <h1>
          候補を集める。違いが見える。<span className="dot">決めやすくなる。</span>
        </h1>
        <p className="lead">URL・PDF・スクショを登録すると、価格・仕様・条件・出典を同じ比較表に整理します。不足情報は Unknown、食い違いは Conflict として見える化します。</p>
        {can(role, 'editor') && (
          <div className="row" style={{ marginTop: 18, position: 'relative', zIndex: 1 }}>
            <button className="btn accent" onClick={() => setOpen(true)}>
              <Icon name="plus" /> 新しい比較
            </button>
          </div>
        )}
      </section>
      {due.data && due.data.length > 0 && (
        <div className="callout ok" style={{ marginBottom: 16 }}>
          振り返り予定日を迎えた判断があります：
          {due.data.map((d) => (
            <Link key={d.id} to={`/w/${ws}/p/${d.projectId}/decision`} style={{ marginLeft: 8 }}>
              {d.title}（{d.reviewDate}）
            </Link>
          ))}
        </div>
      )}
      <div className="page-head">
        <div>
          <h2>マイプロジェクト</h2>
          <p className="sub">比較中のテーマ</p>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && data.length === 0 ? (
        <div className="empty">
          <p>まだ比較プロジェクトがありません。</p>
          {can(role, 'editor') && (
            <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
              最初の比較を作成
            </button>
          )}
        </div>
      ) : (
        <div className="grid cols-3">
          {data?.map((p) => (
            <Link key={p.id} to={`/w/${ws}/p/${p.id}`} className="card accent" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="row spread">
                <span className="badge">{p.status === 'decided' ? '判断済み' : p.status === 'archived' ? 'アーカイブ' : '比較中'}</span>
                <small>{fmtDate(p.updatedAt)}</small>
              </div>
              <h3 style={{ marginTop: 10 }}>{p.title}</h3>
              <p className="muted" style={{ marginTop: 4, minHeight: 22 }}>
                {p.purpose?.slice(0, 80)}
              </p>
              <div className="row" style={{ marginTop: 12 }}>
                <span className="badge">候補 {p.candidateCount}</span>
                <span className="badge">ソース {p.sourceCount}</span>
                {!p.aiEnabled && <span className="badge">AI OFF</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
      <NewProjectModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
